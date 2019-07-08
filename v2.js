/* Подключаемые библиотеки */
const exmo				= require("./exmo");
const config				= require('./config');
const _					= require("underscore");
const clc					= require("cli-color");
const { Console }			= require("console");
const fs					= require("fs");


/* Данные для авторизации */
const apiKey				= 'K-031a67c98ced209dbe1f3b6fedd33febfd0ebf76';
const apiSecret 			= 'S-72ffbe81f849d556866776439926e358b75dafa5';

const output				= fs.createWriteStream('./v2.log', { flag: 'a'});
const logger				= new Console({ stdout: output });

/* Данные для работы функции trade() */
const currency1			= config.cur1;				// Основая
const currency2			= config.cur2;				// торговая пара
const fee					= config.fee;				// Комиссия биржи - 0,2%
const profit				= config.profit;				// Наш профит - 0.5% от каждой продажи
const resale				= config.resale;				// 0.5% надбавка, чтобы не торговать себе в убыток
const currency1MinQuantity 	= config.minquan;				// Мин. кол. единиц для совершения сделки 
const currentPair	= currency1 + "_" + currency2;	// Удобное сокращение для валютной пары

const timeout = 3000;


/*
	Функция заглушка
	В дальнейшем модифицировать так, чтобы
	она писала все сообщения в логовый файл
*/
function log(message) {
	let dt = (new Date()).toLocaleString();
	
	/*
		TODO Add check if setting is exists
	*/
	if (config.debug)
		console.log(dt, message);
	else
		logger.log(dt, message);
}


/*
	Получает время в формате Unix в секундах
*/
function time() {
	
	return parseInt( (new Date()).getTime() / 1000);
}


/* 
	Функция создает ордер на покупку или продажу
	Возвращает объект Promise
*/
function buy(params) {
	
	return new Promise(resolve => {
		exmo.api_query('order_create', params, (result) => {
			let response = JSON.parse(result);
			
			if (response.error)
				resolve(response.error);
			
			resolve(response.order_id);
		});
	});
}


/*
	Основная торговая функция
*/
async function trade() {

	// Получаем список открытых ордеров пользователя
	exmo.api_query('user_open_orders', {}, (result) => {
		let orders = JSON.parse(result);
		
		if (orders.error) {
			return console.log(error);
		}
	
		let sellOrders = _.where(orders[currentPair], {'type': 'sell'});
		let buyOrders	= _.where(orders[currentPair], {'type': 'buy'});
	
		// Найдем ордера на продажу, пока с ними ничего не делаем
		if (sellOrders.length > 0) {
			
		}
	
		// Найдем ордеры на покупку
		if (buyOrders.length > 0) {
			
			// Buy-ордеры старше, чем 2 мин удаляем.
			// Удалить ордеры старше чем две минуты
			// Вызвать апи запрос для каждого ордера, который
			// подпадает под условие выше
			_.each(buyOrders, (order, index) => {
				if (parseInt(order.created) < time() - 60 * 2) {	// Older than 2 minutes, then discontinue it
					// Отменить ордер
					exmo.api_query('order_cancel', {"order_id": order.order_id}, (result) => {
						let r = JSON.parse(result);
						if (r.error)
							return console.error(r.error);
						
						console.log('Canceling order no.', order.order_id);
					});
				}
			});
		}
	
	
		//
		// Этап 2: Создание ордеров на покупку. Алгоритм
		// Если на счету есть крипта, то создать ордер на продажу
		// Если крипты нет, то купить ее
		//
		exmo.api_query('user_info', {}, (result) => {
			let response = JSON.parse(result);
			
			if (response.error) {
				console.error(response.error);
				return
			}
			
			let balance = response.balances;
		
			// Если есть крипта, то создать ордер на ее продажу
			if (parseFloat(balance[currency1]) > currency1MinQuantity) {
			
				log(`Found ${balance[currency1]} ${currency1}. Prepare to create a sell order`);
			
				// Для того, чтобы создать ордер на продажу крипты
				// нужно в начале получить цену !!!последней покупки
				// и среднюю цену продажи; затем подготовить цену
				// продажи с сравнить ее со среднерыночной и если
				// она больше или равна ей то запостить ордер на продажу 
				exmo.api_query('user_trades', {'pair': currentPair, 'limit': 5}, (result) => {
					let trades    = JSON.parse(result);
					
					if (trades.error) {
						console.error(trades.error);
						return
					}
					
					let lastPrice = 0.0;
					trades        = trades[currentPair];
				
					let trade = _.findWhere(trades, {'type': 'buy'});
					if (!trade)
						console.error(clc.red('Cannot find last deal!'));
				
					// Получаем последнюю цену покупки
					lastPrice = parseFloat(trade['price']);
				
					// И начинаем запрос по уточнению среднерыночной
					// цены
					exmo.api_query('trades', {'pair': currentPair}, (result) => {
						let p = JSON.parse(result);
						
						if (p.error) {
							console.error(p.error);
							return
						}
					
						let prices = [];
						let sum = 0.0;
						let trades = _.where(p[currentPair], {'type': 'sell'});
						let timePassed = time() - 60 * 10;		// 10 min

						_.each(trades, (e, i, l) => {
							// Check trade age if its fit, then
							// add its sum and price to the arrays
							if (parseInt(e.date) > timePassed) {
								prices.push(parseFloat(e.price));
								sum += parseFloat(e.price);
							}
						});
					
						// Подготовим цену продажи и сравним ее
						// с ценой lastPrice
						avgPrice = sum / prices.length;
						sellPrice = lastPrice + (lastPrice * resale );
						sellPrice = sellPrice + (sellPrice * fee * profit); 
					
						// Если сейчашняя цена больше цены нужной нам,
						// нет уже размещенных ордеров на продажу
						// то можно разместить ордер на продажу
						if (sellOrders.length) {
							log('Unable to create a sell order, there is one already. Retry...');
							return
						}
						
						if (avgPrice >= sellPrice + (sellPrice * fee * profit)) {
						
							let options = {
								'pair': currentPair,
								'quantity': balance[currency1],
								'price': sellPrice,
								'type': 'sell'
							};
						
							let result = buy(options);
							console.info(clc.green('Создан ордер на продажу'));
							log(`Sell-order created. Sell price: ${sellPrice}; Amount: ${balance[currency1]}`);
						}
						else {
							
							log(`Average price below (${avgPrice}) that we required (${sellPrice}). Retry...`);
						}
					
					
					});
				
				});
			
			
			}
			else { // Крипты нет, значит создать ордер на ее покупку
				log(`Not enough currency are found (${balance[currency1]} ${currency1}) found. Prepare to create a buy order`);
			
				// Запросить последние цены, чтобы на их основе
				// вычислить цену продажи и количество
				exmo.api_query('trades', {'pair': currentPair}, (result) => {		
					var r = JSON.parse(result);
					
					if (r.error) {
						console.error(r.error);
						return
					}
					
					let prices = [];
					let sum = 0.0;
				
					let trades = _.where(r[currentPair], {'type': 'buy'});
					let timePassed = time() - 60 * 10;		// 10 min

					_.each(trades, (e, i, l) => {
						// Check trade age if its fit, then
						// add its sum and price to the arrays
						if (parseInt(e.date) > timePassed) {
							prices.push(parseFloat(e.price));
							sum += parseFloat(e.price);
						}
					});
				
					if (prices.length <= 0) {
						log('Unable to get an average price. Retry...');
						return
					}
					avgPrice = parseFloat(sum / prices.length);
					buyPrice = avgPrice - (avgPrice * fee);
					amount = parseFloat(balance[currency2] - 0.01) / buyPrice;
				

					// Создать ордер можно при выполнении двух условий
					// - у нас нет ордеров на покупку
					// - количество валюты позволяет купить минимальный объем крипты
					if (!buyOrders.length && amount >= currency1MinQuantity) {
				
						let options = {
							'pair': currentPair,
							'quantity': amount,
							'price': buyPrice,
							'type': 'buy'
						};
					
						//console.log(options);
						let result = buy(options);
						
						console.info(clc.blue('Создан ордер на покупку'));
						log(`Buy-order created. Buy price: ${buyPrice}; Amount: ${amount}`);
				
					}	
					else {
						log(`Not enough currency (${balance[currency2]} ${currency2}) to create an order. Waiting for more money`);
					}
				
				});
			
			
			}
		})	// second stage api_query('user_info')
	
	})	// api_query('user_open_orders')

}	// trade()


// Initialize Exmo API library
exmo.init_exmo({key: apiKey, secret: apiSecret});



// Старт маймера
let timer = setInterval(trade, timeout);

