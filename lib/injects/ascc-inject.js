/*
Seller Central Inventory page inject
*/

var ascc = {};
ascc = {
	page: 1,
	pages: 0,
	port: null,
	db: {},
	ifr: false,
	expired: false,

	init: function() {
		var cols, b, tbody, i, e, p, row, rowNum = {}, c = 0, mt = document.querySelector('.manageTable');

		// check if the user is logged in.
		if (document.title == 'Expired Session') {
			ascc.expired = true;
		}

		// determining if were in a work frame
		try {
			if (window.top.location != window.location) {
				ascc.ifr = true;
			} else {
				ascc.ifr = false;
			}
		} catch (e) {
			ascc.ifr = true;
		}

		// if logged out and its a work frame, attempt to force login.
		if (ascc.expired && ascc.ifr) {
			ascc.port = chrome.extension.connect({name: 'ascc'});
			ascc.port.postMessage({action: 'pageExpired'});

			return;
		}

		// manageTable not available, stopping
		if (!mt) return;

		// Read the columns
		var cols = document.getElementsByClassName('subToolBar')[0];
		for (i = 0; i < cols.children.length; i++) {
			b = cols.children[i];

			if (b.children.length > 0) {
				b = b.children[0];
			}

			b = this.trim(b.innerHTML);

			if ( b == 'Merchant SKU' ) {
				rowNum['sku'] = i;
			} else if ( b == 'ASIN/ISBN' ) {
				rowNum['asin'] = i;
			} else if ( b == 'Product Name' ) {
				rowNum['name'] = i;
			} else if ( b == 'Available' ) {
				rowNum['quantity'] = i;
			} else if ( b == 'Your Price' ) {
				rowNum['price'] = i;
			} else if ( b == 'Fulfilled By' ) {
				rowNum['by'] = i;
			} else if ( b == 'Date Created' ) {
				rowNum['created'] = i;
			} else if ( b == 'Condition' ) {
				rowNum['condition'] = i;
			} else if ( b == 'Status' ) {
				rowNum['status'] = i;
			}
		}

		for (b = 0; b < mt.children.length; b++) {
			tbody = mt.children[b];

			// this occurs when you have sub children of an item.
			if ( (tbody.id) || (tbody.id != '') ) {continue;}

			for (i = 0; i < tbody.children.length; i++) {
				row = tbody.children[i];
				if (row.id) {
					if (this.trim(row.children[rowNum['status']].children[0].innerHTML.toLowerCase())  != 'active') {
						continue;
					}

					this.db[c] = {};
					this.db[c]['id'] = row.id;
					(rowNum['sku']) && (this.db[c]['sku'] = row.children[rowNum['sku']].innerHTML);
					(rowNum['asin']) && (this.db[c]['asin'] = this.trim(row.children[rowNum['asin']].firstChild.innerHTML));
					(rowNum['name']) && (this.db[c]['name'] = this.trim(row.children[rowNum['name']].firstChild.innerHTML));
					(rowNum['created']) && (this.db[c]['created'] = row.children[rowNum['created']].innerHTML);
					(rowNum['condition']) && (this.db[c]['condition'] = this.trim(row.children[rowNum['condition']].children[0].innerHTML));
					(rowNum['by']) && (this.db[c]['isAfn'] = this.trim(row.children[rowNum['by']].firstChild.innerHTML) == 'Amazon');

					try {
						if (row.children[rowNum['quantity']].getElementsByTagName("input")[0]) {
							this.db[c]['quantity'] = row.children[rowNum['quantity']].getElementsByTagName("input")[0].value;
						} else {
							this.db[c]['quantity'] = this.trim(row.children[rowNum['quantity']].getElementsByTagName("a")[0].innerHTML);
						}

						p = row.children[rowNum['price']].getElementsByTagName("input")[0];
						this.db[c]['price'] = parseFloat(p.value);
						this.db[c]['priceInput'] = p;

// TODO: reload this when its available.
						try {
							this.db[c]['miShipping'] = document.getElementById("yourPriceShippingCharge_price|" + this.db[c].sku + "|" + this.db[c].asin).innerHTML;
							this.db[c]['miShipping'] =  parseFloat(this.db[c]['miShipping'].match(/[\d\.?]+/));
						} catch (errr) {
							debug(["[ascc-inject.init] Missing shipping price for this item", this.db[c].sku]);
							this.db[c]['miShipping'] = 0;
						}
					} catch (err) {
						debug(['[ascc-inject.init] error reading inventory', err]);
					}
				}

				c++;
			}
		}

		this.getPages();

		// prices processed, let background know
		ascc.port = chrome.extension.connect({name: 'ascc'});
		ascc.port.onMessage.addListener(
		  function(request) {
		    if (request.action == 'save') {
		    	try {
					debug('[ascc-inject.init] save requested');
					ascc.ajaxSave(request.db);
				} catch (e) {
					ascc.port.postMessage({action: 'exceptionOnSave', page: ascc.page, error: e});
				}
		    } else if (request.action == 'flipPage') {
		    	ascc.goto(request.page);
		    } else if (request.action == 'updateMarkers') {
		    	ascc.updateMarkers(request.db);
		    }
		});

		ascc.port.postMessage({action: 'pageFinished', page: ascc.page, pages: ascc.pages, frame: ascc.ifr});


		var db = {};
		for (e in ascc.db) {
			db[ascc.db[e].id] = {};
			db[ascc.db[e].id]['asin'] = ascc.db[e].asin;
			db[ascc.db[e].id]['created'] = ascc.db[e].created;
			db[ascc.db[e].id]['isAfn'] = ascc.db[e].isAfn;
			db[ascc.db[e].id]['name'] = ascc.db[e].name;
			db[ascc.db[e].id]['price'] = ascc.db[e].price;
			db[ascc.db[e].id]['sku'] = ascc.db[e].sku;
			db[ascc.db[e].id]['condition'] = ascc.db[e].condition;
		}

		ascc.port.postMessage({action: 'pageDatabase', page: ascc.page, db: db, url: document.location.href, frame: ascc.ifr});


		// Accessing window.METADATA 
		var scr = document.getElementsByTagName("script");
		for (var i = 0; i < scr.length; i++) {
			if (scr[i].innerHTML.indexOf('window.METADATA = {') != -1) {
				var meta = scr[i].innerHTML.substring(scr[i].innerHTML.indexOf('window.METADATA = {'));
				meta = meta.substring(0, meta.lastIndexOf('});') - 3);
				meta = meta.replace('window.METADATA', 'METADATA');
				eval(meta);
			}
		}

		// Accessing csrfToken
		ascc.csrfToken = document.getElementById('csrfToken').value;
	},

	getPages: function() {
		var e = document.getElementById('goToPage');

		if (e) {
			this.page = e.value;
			e = e.parentNode;
			this.pages = e.lastChild.textContent.replace(' of ', ''); // of X
		} else {
			// pager missing, most likely only a single page.
			this.page = 1;
			this.pages = 1;
		}
	},

	updateMarkers: function(bgDb) {
		debug('[ascc-inject.init] Updating markers');

		var e, i, c, n;

		for (e in ascc.db) {
			i = ascc.db[e];
			j = bgDb[i.asin];
			c = '';

			if ( (j) && (j.newPrice) && (i.priceInput) && (i.price) ) {
				if (i.price < j.newPrice) {
					c = 'green';
				} else if (i.price > j.newPrice) {
					c = 'red';
				}
				
				if (!isNaN(j.newPrice)) {
					i.priceInput.value = Math.round( j.newPrice * 100) / 100;
				}

				if (c)
					i.priceInput.style.border = '2px solid ' + c;
			}
		}

		// for future debugging of saving, start here.
		// ascc.ajaxSave(bgDb);
	},

	ajaxSave: function(bgDb) {
		debug('[ascc-inject.ajaxSave] ajaxSave called');

		try {
			var f;
			for (var i = 0; i < document.getElementsByTagName('form').length; i++) {
				if ( 'itemSummaryForm' == this.trim(document.getElementsByTagName('form')[i].name) ) {
					f = document.getElementsByTagName('form')[i];
				}
			}

			if ( !f || !f.elements ) {
				debug('[ascc-inject.ajaxSave] missing save form');
				return;
			}

			var action = f.action;
			action = action.replace(/;jsessionid=[\d|\D|0-9]*/g,"");
			action += ".ajax";
			var params = new Array();
			var priceMetricDataJsonString = {};
			var submitData = {};

			for (var e in ascc.db) {
				var i = ascc.db[e];
				var j = bgDb[i.asin];

				if (!j.newPrice) continue;

				if (i.price == j.newPrice) {
					continue;
				}

				var unencSku = i.id.replace('sku-', '');
				var encSku = METADATA.rowData[unencSku]._encSku;

				submitData[encSku] = {};
				submitData[encSku].getSku = i.sku;
				submitData[encSku].getAsin = i.asin;
				submitData[encSku].OLD_PRICE = i.price.toString();
				submitData[encSku].NEW_PRICE = ascc.format(j.newPrice.toString());
				submitData[encSku].OLD_INV = '';
				submitData[encSku].NEW_INV = '';

				submitData[encSku].OLD_MAXPRICE = '';
				submitData[encSku].NEW_MAXPRICE = '';
				submitData[encSku].OLD_MINPRICE = '';
				submitData[encSku].NEW_MINPRICE = '';
				
				submitData[encSku].productType = METADATA.rowData[unencSku].productType;
				
				submitData[encSku].priceMetrics = {"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null};
				submitData[encSku].lowPrice = '';
				submitData[encSku].HPS = '';
			}

			submitData = JSON.stringify(submitData);

			if ( (submitData.length > 0) && (submitData != '{}') ) {
				f.elements['formOperation'].value = 'ajaxUpdate';
				params.push(f.elements['formOperation']);
				params.push(f.elements['marketplaceID']);

				var postData = jQuery.param(params) + "&csrfToken=" + encodeURIComponent(ascc.csrfToken) + "&changedDataJSON=" + encodeURIComponent(submitData);

				debug('[ascc.ajaxSave] ' + postData);
/*
formOperation:ajaxUpdate
marketplaceID:ATVPDKIKX0DER
csrfToken:gEyZmU9ETHgm2X3kKI7+DOr9p5I3WU6nGorLgVoAAAACAAAAAFLDJCJyYXcAAAAA
changedDataJSON:{"Tk4tSVpKVC03TjNW":{"getSku":"NN-IZJT-7N3V","getAsin":"B00BAXYL6U","OLD_PRICE":"48.4","NEW_PRICE":"68.99","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"MISC_OTHER","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""},"OTItSVpWQy1MUE0y":{"getSku":"92-IZVC-LPM2","getAsin":"B00BC0KXCW","OLD_PRICE":"36.2","NEW_PRICE":"37.788","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"BEAUTY","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""},"SkUtOTVXWi1TT1lD":{"getSku":"JE-95WZ-SOYC","getAsin":"B002RGRJC2","OLD_PRICE":"36.74","NEW_PRICE":"37.788","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"BEAUTY","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""},"NTQtSURDUy1UQkxV":{"getSku":"54-IDCS-TBLU","getAsin":"B0013945CQ","OLD_PRICE":"30.39","NEW_PRICE":"32.388","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"BEAUTY","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""},"NzMtMzM2Si1QRjFE":{"getSku":"73-336J-PF1D","getAsin":"B0046HHFRE","OLD_PRICE":"15.99","NEW_PRICE":"20.988000000000003","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"BEAUTY","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""},"U04tWktZSC1aVTFG":{"getSku":"SN-ZKYH-ZU1F","getAsin":"B00D8DSDHS","OLD_PRICE":"16.59","NEW_PRICE":"18.588","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"BEAUTY","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""},"U1ktU1kwRS1NTU8z":{"getSku":"SY-SY0E-MMO3","getAsin":"B00375L8JC","OLD_PRICE":"15.95","NEW_PRICE":"18.948","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"BEAUTY","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""},"NDUtOUk3OC1DWkYw":{"getSku":"45-9I78-CZF0","getAsin":"B009NT6KD0","OLD_PRICE":"59.39","NEW_PRICE":"65.388","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"BEAUTY","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""},"MkQtWTNCWS1KWk0z":{"getSku":"2D-Y3BY-JZM3","getAsin":"B003E0W9W0","OLD_PRICE":"15.47","NEW_PRICE":"18.468","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"HEALTH_PERSONAL_CARE","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""},"TFItUU9MMS1VUUQw":{"getSku":"LR-QOL1-UQD0","getAsin":"B0054Y1JJI","OLD_PRICE":"58.96","NEW_PRICE":"60.0162","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"PERSONAL_CARE_APPLIANCE","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""}}

formOperation:ajaxUpdate
marketplaceID:ATVPDKIKX0DER
csrfToken:gLM/e+Ahky7nLeOaOXtZbt72SzIpHWVPpDkUbKoAAAACAAAAAFLDIx5yYXcAAAAA
changedDataJSON:{"Tk4tSVpKVC03TjNW":{"getSku":"NN-IZJT-7N3V","getAsin":"B00BAXYL6U","OLD_PRICE":"48.39","NEW_PRICE":"48.40","OLD_INV":"","NEW_INV":"","OLD_MAXPRICE":"","NEW_MAXPRICE":"","OLD_MINPRICE":"","NEW_MINPRICE":"","productType":"MISC_OTHER","priceMetrics":{"lowPriceShippingCharge":null,"lowPriceItemPrice":null,"yourPriceShippingCharge":null,"salePrice":null},"lowPrice":"","HPS":""}}
*/
				$.ajax({
					type: "POST",
					dataType: "json",
					url: action,
					data: postData,
					success: function(data) {
						debug(['[ascc.ajaxSave] server response', data]);
						ascc.port.postMessage({action: 'saved', page: ascc.page});

						document.location.reload(true);
					},
					error: function(data) {
						debug(['[ascc.ajaxSave] remote error', data]);
					},
					timeout: 60000
				});

			} else {
				// nothing to save
				debug('[ascc-inject.ajaxSave] no updated prices, skipping saving');
				ascc.port.postMessage({action: 'skipped', page: ascc.page});

				// TODO: we may skip this
				document.location.reload(true);
			}
		} catch (err) {
			debug(['[ascc.ajaxSave] script error', err]);
		}
	},

	// this currently seems not to work.
	save: function(bgDb) {
		var i, j, evt, e;

		// process database items and then save.
		for (e in ascc.db) {
			i = ascc.db[e];
			j = bgDb[i.asin];

			if ( (j) && (j.newPrice) && (i.priceInput) && (i.price) ) {
				if (i.price != j.newPrice) {
					debug('[ascc-inject.save] Setting new price for: ' + i.asin + ' previous: ' + i.price + ' new: ' + j.newPrice);
					i.priceInput.value = Math.round( j.newPrice * 100) / 100;
				} else {
					// console.log('Price unchanged for: ' + i.asin + ' skipping');
				}
			}
		}

		ascc.port.postMessage({action: 'saving', page: ascc.page});

		e = document.getElementsByTagName('form');
		for (i = 0; i < e.length; i++) {
			if ( 'itemSummaryForm' == this.trim(e[i].name) ) {
				e[i].formOperation.value = 'saveChanges';
				e[i].submit();
			}
		}
	},

	goto: function(page) {
		document.location.href = 'https://sellercentral.amazon.com/myi/search/ProductSummary?searchPageOffset=' + page;
	},

	trim: function(str) {
		var newstr;
		newstr = str.replace(/^\s*/, "").replace(/\s*$/, ""); 
		newstr = newstr.replace(/\s{2,}/, " "); 
		return newstr;
	},

	format: function (value) {
		if (!value) { return ''; }
		var value = value.toString().split('.');
		var cent = value.length == 1 ? '' : ( value[1].length == 1 ? "." + value[1] + "0" : "." + value[1].substring(0,2) );

		if (!cent) {
			cent = '.00';
		}

		return(value[0] + cent);
	}
}

function debug() {
	if (arguments.length > 0) {
		var d = new Date(Date.now());

		var o = [];
		o.push('[' + d.getHours() + ':'+ ( d.getMinutes() < 9 ? '0' + d.getMinutes() : d.getMinutes() ) + ']');

		for (var i = 0; i < arguments.length; i++) {
			o.push(arguments[i]);
		}

		console.log(o.join(' '));
	}
}

window.addEventListener( "load", function() {
	setTimeout(function() {
			ascc.init();
		}, 4000);
}, false );