// TODO out of stock items price set to undefined?
// TODO when price checking, if all items are in the competitor set, need to page to the next offer page -- complete offer-listing
// TODO? variable margin

/**
Operation:
1) Install extension
2) Log into https://sellercentral.amazon.com
3) Set display to the maximum # -- 250 items
4) Open ASCC options and configure everything
5) Open database and load items from Amazon
6) Set original price, shipping, and margin per item
7) User ASCC to update competitors price
8) Enable and enjoy
*/

var VERSION = (function () {
	var xhr = new XMLHttpRequest();
	xhr.open('GET', chrome.extension.getURL('manifest.json'), false);
	xhr.send(null);
	return JSON.parse(xhr.responseText).version;
}());

// webRequest stuff: stripping x-frame-options.
chrome.webRequest.onHeadersReceived.addListener(stripHeaders, {
	urls: ["http://www.amazon.com/gp/offer-listing/*",
			   "http://www.amazon.co.uk/gp/offer-listing/*",
			   "http://www.amazon.de/gp/offer-listing/*"]},
	['blocking', "responseHeaders"]);

// bucket defaults
var bucketFeatured = (localStorage['bucketFeatured'] === 'true' ? true : false),
 bucketNew = (localStorage['bucketNew'] === 'true' ? true : false),
 bucketUsed = (localStorage['bucketUsed'] === 'true' ? true : false);

if (!bucketFeatured && !bucketNew && !bucketUsed) {
	// setting default
	localStorage['bucketFeatured'] = 'true';
}

var page, pages, savedPage, savingTimeout, forceRestartTimeout,
 currentStatus = 'doing nothing',
 currentPage = 0,
 db = {},
 country = '',
 runs = 0,
 disabled = true;

chrome.extension.onConnect.addListener(
	function(port) {
		if (port.name == 'ascc') {
			port.onMessage.addListener(function(request) {
				if (request.action == 'pageFinished') {
					pages = request.pages;
					page = request.page;

					// background process only when frame caller is a frame.
					if (disabled) { return; }
					if (!request.frame) { return; }


					if (currentPage != savedPage) {
						clearTimeout(savingTimeout);
						currentStatus = 'saving new prices';
						port.postMessage({action: 'save', db: db});
						currentPage = page;

						savingTimeout = setTimeout(function() {
							debug('Saving Timeout occured. Attempting restart.');
							startBackground();
						}, 60 * 60 * 1000);
					} else {
						if (currentPage != pages) {
							currentStatus = 'flipping page';
							currentPage++;
							debug('Flipping page to ' + currentPage);
							port.postMessage({action: 'flipPage', page: currentPage});
						} else {
							clearTimeout(savingTimeout);

							debug('All pages processed');
							currentStatus = 'waiting to update competitors';

							// Total number of runs so far.
							runs ++;

							// Sleep and kick off next competitor update in 30 minutes.
							setTimeout(function() {
								if (updatingCompetitors) {
									debug('skipping update competitors, previous run not completed?');
									currentStatus = 'competitor update skipped: still updating from previous run';
								} else {
									debug('updating competitors for the next round.');
									updateCompetitors();
									currentStatus = 'updating competitors, next update in 15 minutes';
								}
							}, 15 * 60 * 1000);

							// Sleep and kick off next iteration in 60 minutes.
							setTimeout(function() {
								debug('Resetting for the next round.');
								currentStatus = 'waiting to start next round';

								savedPage = -1;
								currentPage = 0;

								// login page.  Force login if needed.
								// Note: were not checking if a login actually occured here, but loading processing page at onload.
								//	Might make sense to do this only if a login is needed.
								if ( localStorage['amazonLogin'] && localStorage['amazonPass'] ) {
									var f = document.getElementById('work');
									f.src = getCountryUrl() + '/gp/homepage.html';
									clearTimeout(forceRestartTimeout);
					
									f.onload = function() {
										debug('Force login complete. Restarting operations in 60 seconds.');
										forceRestartTimeout = setTimeout(function() {
											var f = document.getElementById('work');
											f.src = getCountryUrl() + '/myi/search/ItemSummary.amzn';
										}, 60 * 1000);
									}
								} else {
									debug('[FATAL] Unable to restart since no login options are entered in the options. Repricing aborted.');
								}
							}, 60 * 60 * 1000);
						}
					}

				} else if (request.action == 'saving') {
					savedPage = request.page;
					debug('Saved this page: ' + request.page);

				} else if (request.action == 'exceptionOnSave') {
					savedPage = request.page;
					debug('Exception thrown on save: ' + request.error);
// TODO: resume processing on next page?
				} else if (request.action == 'pageDatabase') {
					// set country if needed.
					if (country == '') {
						setCountry(request.url);
					}

					// Record the database
					for (var i in request.db) {
						// skip if already in the database.
						if (db[request.db[i]['asin']]) {
							// copy price, then continue
							db[request.db[i]['asin']].price = request.db[i].price;
							continue;
						}

						db[request.db[i]['asin']] = request.db[i];

						var ls = localStorage[request.db[i]['asin'] + '|originalPrice'];
						if (ls) {
							db[request.db[i]['asin']].originalPrice = ls;
						}

						ls = localStorage[request.db[i]['asin'] + '|margin'];
						if (ls) {
							db[request.db[i]['asin']].margin = ls;
						}

						ls = localStorage[request.db[i]['asin'] + '|shipping'];
						if (ls) {
							db[request.db[i]['asin']].shipping = ls;
						}

						// updating new price and minimum
						setRest(db[request.db[i]['asin']]);
					}

					debug('Copied this page\'s database: ' + request.page);

					if (!request.frame)
						port.postMessage({action: 'updateMarkers', db: db});
				} else if (request.action == 'pageExpired') {
					debug('Work frame reporting expired session.  Attempting relogin and restart.');
					
					if ( localStorage['amazonLogin'] && localStorage['amazonPass'] ) {
						var f = document.getElementById('heartbeat');
						f.src = getCountryUrl() + '/gp/homepage.html';
						f.onload = function() {
							debug('Force login complete. Restarting operations.');
							setTimeout(function() {
								var f = document.getElementById('work');
								f.src = getCountryUrl() + '/myi/search/ItemSummary.amzn';
							}, 60 * 1000);
						}
					} else {
						debug('[FATAL] Unable to restart since no login options are entered in the options. Repricing aborted.');
					}
				}
			});
		} else if (port.name == 'offer') {
			port.postMessage({action: 'exclusionList', exclusions: localStorage['exclusions'], buckets: (localStorage['bucketFeatured'] === 'true' ? 'featured' : '') + '|' + (localStorage['bucketNew'] === 'true' ? 'new' : '') + '|' + (localStorage['bucketUsed'] === 'true' ? 'used' : '') + '|' + (localStorage['bucketItem'] === 'true' ? 'item' : '') });

			port.onMessage.addListener(function(request) {
				if (request.action == 'lowest-offer') {
					try {
						db[request.asin].lowestCompetitor = request.lowest;
						// updating new prices and minimum
						setRest(db[request.asin]);
					} catch (err) {
						debug('Couldnt set lowest competitor price -- item not in the database?');
					}
				} else if (request.action == 'new-exclusion') {
					// add a new exclusion to the exclusions list
					var ex = request.seller.trim();

					if (ex) {
						var elist = localStorage['exclusions'];

						if (!elist) {
							elist = [];
						} else {
							elist = elist.split(',');
						}

						elist.push(ex);
						localStorage['exclusions'] = elist.join(',');
					}
				} else if (request.action == 'requestItemBucket') {
					port.postMessage({action: 'itemBucket', bucket: db[request.asin].condition });
				}
			});
		} else if (port.name == 'country') {
			port.onMessage.addListener(function(request) {
				if (request.action == 'sendUrl') {
					// set country if needed.
			  	setCountry(request.url);

			  	debug('Country port connected, url: ' + request.url + ' set country to: ' + country);

					if (!request.loggedIn) {
						// force log in.
						port.postMessage({action: 'login', login: localStorage['amazonLogin'], pass: localStorage['amazonPass'] });
					}
			  }
			});
		}
	});

/**
 * This function attempts to load entire accessible items list from the users 
 * amazon seller console.  Only tries to load a max of 5 pages, so have users
 * configure the display for maximum number of items shown per page: 250;
 */
var pageFlag = false; loadingItems = false;
function loadItems() {
	debug('loadItems called');

	var i, f;
	loadingItems = true;

	if (pages) {
		if (pages <= 10) {
			for (i = 1; i <= pages; i++) {
				createFrames();
				debug('loading page ' + i);
				f = document.getElementById('lo-' + (i - 1) );
				f.src = getCountryUrl() + '/myi/search/DefaultView.amzn?searchPageOffset=' + i;
			}
		} else {
			debug('Requesting number reset from the user.');
			alert('Please set the number of displayed items in Amazon to maximum (250+).')
		}
	} else {
		// lets try to grab page count
		if (!pageFlag) {
			debug('Reloading page number');
			createFrames();

			pageFlag = true;
			f = document.getElementById('lo-0');
			f.src = getCountryUrl() + '/myi/search/DefaultView.amzn?searchPageOffset=1';

			setTimeout(function() {
					loadItems();
				}, 10 * 1000);
			}
	}

	loadingItems = false;
}

/**
 * This function is used to run the heartbeat monitoring so the user is not logged out 
 * while the extension runs and background processing is enabled.
 */
var heartbeatTimeout = null;
function heartbeatSensor() {
	if (!disabled) {
			heartbeatTimeout = setInterval(function() {
				var f = document.getElementById('heartbeat');
				f.src = getCountryUrl() + '/gp/homepage.html';
			}, 10 * 60 * 1000);
	} else {
		clearInterval(heartbeatTimeout);
	}
}

/**
 * This function is used to load the prices of competitors enmasse via
 * iframe loads.
 */
var updatingCompetitors = false, lastAsin;
function updateCompetitors() {
	createFrames();

	var i, j, f, next = false, a = [], count = 0;
	updatingCompetitors = true;

	for (i in db) {
		// skipping items that are missing required info: original, shipping, or margin
		if (db[i].isAfn) {
			if ( (!db[i].margin) || (!db[i].originalPrice) )
				continue;
		} else {
			if ( (!db[i].margin) || (!db[i].originalPrice) || (!db[i].shipping) )
				continue;
		}

		if (lastAsin) {
			if (db[i].asin != lastAsin) {
				continue;
			}

			// at the last one
			lastAsin = null;
			continue;
		}

		a.push(db[i].asin);

		if (a.length == 10) {
			debug('processing batch', a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9]);

			for (j = 0; j < a.length; j++) {
				f = document.getElementById('lo-' + j);
				if (db[i].condition 
					&& ( db[i].condition.indexOf('Used') >= 0 ) ) {
					f.src = getCountryOfferUrl() + '/gp/offer-listing/' + a[j] + '/?ie=UTF8&condition=used';
				} else if (db[i].condition 
					&& ( db[i].condition.indexOf('Collectible') >= 0 ) ) {
					f.src = getCountryOfferUrl() + '/gp/offer-listing/' + a[j] + '/?ie=UTF8&condition=collectible';
				} else {
					f.src = getCountryOfferUrl() + '/gp/offer-listing/' + a[j] + '/ref=olp_seeall_fm?ie=UTF8&shipPromoFilter=0&startIndex=0&sort=sip&me=&condition=new';
				}
			}

			lastAsin = a[9];
			a = [];

			setTimeout(function() {
					updateCompetitors();
				}, 45 * 1000);

			next = true;
			break;
		}
	}

	if ( (a.length > 0) && (a.length < 10) ) {
		debug('processing last batch');

		for (j = 0; j < a.length; j++) {
			debug(a[j]);

			f = document.getElementById('lo-' + j);
			if (db[a[j]].condition 
				&& ( db[a[j]].condition.indexOf('Used') >= 0 ) ) {
				f.src = getCountryOfferUrl() + '/gp/offer-listing/' + a[j] + '/?ie=UTF8&condition=used';
			} else if (db[a[j]].condition 
				&& ( db[a[j]].condition.indexOf('Collectible') >= 0 ) ) {
				f.src = getCountryOfferUrl() + '/gp/offer-listing/' + a[j] + '/?ie=UTF8&condition=collectible';
			} else {
				f.src = getCountryOfferUrl() + '/gp/offer-listing/' + a[j] + '/ref=olp_seeall_fm?ie=UTF8&shipPromoFilter=0&startIndex=0&sort=sip&me=&condition=new';
			}
		}

		setTimeout(function() {
				removeFrames();
			}, 45 * 1000);
	}

	if (!next) {
		updatingCompetitors = false;
		lastAsin = null;
	}
}

/**
 * This function will attempt to reset and clear the used frames.
 */
var framesPresent = false;
function createFrames() {
	if (framesPresent) return;

	framesPresent = true;
	debug('creating work frames');
	var j, f;
	for (j = 0; j < 10; j++) {
		f = document.createElement("IFRAME");
		f.setAttribute("src", "");
		f.id = 'lo-' + j;
		document.body.appendChild(f); 
	}
}

/**
 * This function will attempt to reset and clear the used frames.
 */
function removeFrames() {
	debug('clearing work frames');
	var j, f;
	for (j = 0; j < 10; j++) {
		f = document.getElementById('lo-' + j);
		f.parentNode.removeChild(f);
	}

	framesPresent = false;
}

/**
 * This function kicks off the iframe for background processing.
 */
var backgroundTimeout;
function startBackground() {
	if (!disabled) {
		var f = document.getElementById('work');
		f.src = getCountryUrl() + '/myi/search/ItemSummary.amzn';
	} else {
		currentStatus = 'doing nothing';
	}
}

function resetDb() {
	if (disabled) {
		page = null;
		pages = null;
		savedPage = null;
		currentPage = 0;
 		db = {};
 		country = '';
 		updatingCompetitors = false;
	}
}

function setRest(item) {
	var p = new MathProcessor(),
	 step = Math.round( parseInt( ( localStorage['step'] ? localStorage['step'] : 1 ) ) * 100) / 100 / 100,
	 afnPercentage = parseInt( ( localStorage['afnPercentage'] ? localStorage['afnPercentage'] : 26 ) ),
	 merchantPercentage = parseInt( ( localStorage['merchantPercentage'] ? localStorage['merchantPercentage'] : 16 ) ),
	 merchantMinimumFormula = ( localStorage['merchantMinimumFormula'] ? localStorage['merchantMinimumFormula'] : '(originalPrice + margin + shipping) + ( ( (originalPrice + margin + shipping) / 100 ) * merchantPercentage )' ),
	 afnMinimumFormula = ( localStorage['afnMinimumFormula'] ? localStorage['afnMinimumFormula'] : '(originalPrice + margin) + ( ( (originalPrice + margin) / 100 ) * afnPercentage )' );

	if (item.isAfn) {
		item.newPrice = parseFloat( item.lowestCompetitor );

		// setup actual formula
		item.minimumPrice = afnMinimumFormula
		 .replace(/originalPrice/g, item.originalPrice)
		 .replace(/margin/g, item.margin)
		 .replace(/afnPercentage/g, afnPercentage)
		 .replace(/lowestCompetitor/g, item.lowestCompetitor);

		try { item.minimumPrice = p.parse(item.minimumPrice); } catch (e) { return; }

		if ( (item.lowestCompetitor) && (item.originalPrice) && (item.margin) ) {
			if (item.newPrice >= item.minimumPrice) {
				item.newPrice = Math.round( (item.lowestCompetitor - step) * 100) / 100;
			} else {
				item.newPrice = Math.round( item.minimumPrice * 100) / 100;
			}
		} else {
			if (item.price <= item.minimumPrice) {
				item.newPrice = item.minimumPrice;
			} else {
				item.newPrice = item.price;
			}
		}
	} else {
		// setup actual formula
		item.minimumPrice = merchantMinimumFormula
		 .replace(/originalPrice/g, item.originalPrice)
		 .replace(/margin/g, item.margin)
		 .replace(/shipping/g, item.shipping)
		 .replace(/merchantPercentage/g, merchantPercentage)
		 .replace(/lowestCompetitor/g, item.lowestCompetitor);

		try { item.minimumPrice = p.parse(item.minimumPrice); } catch (e) { return; }

		if ( (item.lowestCompetitor) && (item.originalPrice) && (item.margin) && (item.shipping) ) {
			item.newPrice = parseFloat( item.lowestCompetitor );

			if (item.newPrice >= item.minimumPrice) {
				item.newPrice = Math.round( (item.lowestCompetitor - step) * 100) / 100;
			} else {
				item.newPrice = Math.round( item.minimumPrice * 100) / 100;
			}
		} else {
			if (item.price <= item.minimumPrice) {
				item.newPrice = item.minimumPrice;
			} else {
				item.newPrice = item.price;
			}
		}
	}

	debug(item.asin, 'setting minimum and new price', item.newPrice);
}

function setCountry(u) {
	if (u.indexOf('amazon.co.uk') >= 0) {
 		// were in england baby!
 		country = 'uk';
 	} else if (u.indexOf('amazon.de') >= 0) {
 		// deutchland!
 		country = 'de';
 	} else {
 		// assuming us.
 		country = 'us';
 	}
}

/**
 * This function returns appropriate URL according to the current store.
 */
function getCountryUrl() {
	var u = '';

	if (country == 'uk') {
		u = 'https://sellercentral.amazon.co.uk';
	} else if (country == 'de') {
		u = 'https://sellercentral.amazon.de';
	} else {
		u = 'https://sellercentral.amazon.com';
	}
	
	return u;
}

/**
 * This function returns appropriate URL according to the current store.
 */
function getCountryOfferUrl() {
	var u = '';

	if (country == 'uk') {
		u = 'http://www.amazon.co.uk';
	} else if (country == 'de') {
		u = 'http://www.amazon.de';
	} else {
		u = 'http://www.amazon.com';
	}
	
	return u;
}

function debug() {
	if (arguments.length > 0) {
		var d = new Date(Date.now());

		var o = [];
		o.push('[' + d.getHours() + ':'+ d.getMinutes() + ']');

		for (var i = 0; i < arguments.length; i++) {
			o.push(arguments[i]);
		}

		console.log(o);
	}
}

function stripHeaders(req) {
	for (var i = 0; i < req.responseHeaders.length; ++i) {
		if (req.responseHeaders[i].name.toLowerCase() === 'x-frame-options') {
			req.responseHeaders.splice(i, 1);
			break;
		}
	}

	return {responseHeaders: req.responseHeaders};
}