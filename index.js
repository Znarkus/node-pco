var express = require('express');
var app = express();
var _ = require('lodash');
var hbs = require('hbs');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var passport = require('passport');
var OAuthStrategy = require('passport-oauth').OAuthStrategy;
var request = require('request');
var moment = require('moment');
var OAuth   = require('oauth-1.0a');
var debug = require('debug')('app');
var Promise = require('bluebird');
var util = require('util');
var config = require('./config.json');
var oauthConfig = config.oauth;
var oauthClient = OAuth({
	consumer: {
		public: oauthConfig.consumerKey,
		secret: oauthConfig.consumerSecret
	},
	signature_method: 'HMAC-SHA1'
});
var people = {};

passport.use('provider', new OAuthStrategy(oauthConfig,
	function(token, tokenSecret, profile, done) {
		console.log(arguments);
		done(null, {
			public: token,
			secret: tokenSecret
		});
	}
));

passport.serializeUser(function(user, done) {
	done(null, JSON.stringify(user));
});

passport.deserializeUser(function(user, done) {
	done(null, JSON.parse(user));
});

app.use(cookieParser());
app.use(session({ secret: 'keyboard cat' }));
app.use(passport.initialize());
app.use(passport.session());
app.set('view engine', 'html');
app.engine('html', require('hbs').__express);

hbs.registerHelper('indent_pixels', function(level) {
	return level * 20 + 'px';
});

hbs.registerHelper('debug', function(obj) {
	return util.inspect(obj);
});

hbs.registerHelper('format_date', function(date) {
	return moment(date).format('DD MMM YYYY');
});

/*app.post('/login',
	passport.authenticate('provider'),
	function(req, res) {
		// If this function gets called, authentication was successful.
		// `req.user` contains the authenticated user.
		res.redirect('/users/' + req.user.username);
	});*/

function auth(req, res, next) {
	if (req.user) {
		next();
	} else {
		//req.session.authReturnUrl = req.originalUrl;
		res.redirect('/auth/provider');
	}
}

function callApi(user, method, url, cb) {
	var request_data = {
		url: url,
		method: method
		//data: {
		//	status: 'Hello Ladies + Gentlemen, a signed OAuth request!'
		//}
	};

	var token = {
		public: user.public,
		secret: user.secret
	};

	return new Promise(function(resolve) {
		request({
			url: request_data.url,
			method: request_data.method,
			form: oauthClient.authorize(request_data, token)
		}, function(error, response, body) {
			debug(body);
			body = JSON.parse(body);
			//console.log(body);
			resolve(body);
		});
	});
}

app.get('/', auth, function (req, res) {
	var items = [];

	callApi(req.user, 'GET', 'https://services.planningcenteronline.com/organization.json').then(function(response) {

		recurse(response, 0);

		function recurse(level, levelIndex) {
			_.forEach(level.service_types, function(type) {
				console.log(type);
				type.level = levelIndex;
				items.push(type);
			});

			_.forEach(level.service_type_folders, function(folder) {
				console.error(folder);
				folder.level = levelIndex;
				items.push(folder);
				recurse(folder, levelIndex + 1);
			});
		}

		res.render('index', { items: items });
	});
});

//function loadPeople(req, res, next) {
//	if (people) {
//		next();
//	} else {
//		callApi(req.user, 'GET', 'https://services.planningcenteronline.com/people.json', function(response) {
//			people = {};
//
//			_.forEach(response.people, function(person) {
//				people[person.id] = person;
//			});
//
//			next();
//		});
//	}
//}

function fillListWithPersonData(user, items) {
	return load(0);

	function load(index) {
		return loadPerson(user, items[index].person_id).then(function(person) {
			items[index].person = person;

			if (index + 1 < items.length) {
				return load(index + 1);
			}
		})
	}

}

function loadPerson(user, id) {
	if (people[id]) {
		return Promise.resolve(people[id]);
	} else {
		return callApi(user, 'GET', 'https://services.planningcenteronline.com/people/' + id + '.json').then(function(response) {
			people[id] = response;
			return response;
		});
	}
}

app.get('/:typeId(\\d+)', auth, function(req, res) {
	callApi(req.user, 'GET', 'https://services.planningcenteronline.com/service_types/' + req.params.typeId + '/plans.json').then(function(response) {
		res.render('plans', { items: response });
	});
});

app.get('/:typeId(\\d+)/:planId(\\d+)', auth, function(req, res) {
	callApi(req.user, 'GET', 'https://services.planningcenteronline.com/plans/' + req.params.planId + '.json').then(function(response) {
		return [response, fillListWithPersonData(req.user, response.plan_people)];
	}).spread(function(response) {
		res.render('plan', { data: response, people: people });
	});
});

app.get('/sunday', auth, function(req, res) {
	var sundayDate = moment().day(7);
	var services = [];
	var filter = {
		serviceTypes: req.query.serviceType.split(',').map(_.parseInt),
		categoryNames: req.query.categoryName.toLowerCase().split(','),
		excludePositions: req.query.excludePosition ? req.query.excludePosition.toLowerCase().split(',') : []
	};

	promisesForEachParallel(filter.serviceTypes, function(serviceType) {
		return callApi(req.user, 'GET', 'https://services.planningcenteronline.com/service_types/' + serviceType + '/plans.json').then(function(response) {
			return promisesForEachParallel(response, function(service) {
				//var date = new Date(service.sort_date);
				if (sundayDate.isSame(service.sort_date, 'day')) {
					return callApi(req.user, 'GET', 'https://services.planningcenteronline.com/plans/' + service.id + '.json').then(function(response) {
						services.push(response);
						//fillListWithPersonData(req.user, response.plan_people, function() {
						//	res.render('plan', { data: response, people: people });
						//});
					});
				}
			});
		})
	}).then(function() {
		return promisesForEachParallel(services, function(service) {
			service.filteredPeople = [];

			return promisesForEachParallel(service.plan_people, function(person) {
				if (_.indexOf(filter.categoryNames, person.category_name.toLowerCase()) != -1) {
					if (_.indexOf(filter.excludePositions, person.position.toLowerCase()) == -1) {
						if (person.status != 'D') {
							service.filteredPeople.push(person);
						}
					}
				}
			});
		});
	}).then(function() {
		return promisesForEachParallel(services, function(service) {
			return fillListWithPersonData(req.user, service.filteredPeople);
		});
	}).then(function() {
		res.render('sunday', { services: services, sundayDate: sundayDate });
	});
});

function promisesForEachParallel(items, iteratorCb) {
	var promises = [];

	_.forEach(items, function(item, key) {
		promises.push(iteratorCb(item, key));
	});

	return Promise.all(promises);
}

// Redirect the user to the OAuth provider for authentication.  When
// complete, the provider will redirect the user back to the application at
//     /auth/provider/callback
app.get('/auth/provider', passport.authenticate('provider'));

// The OAuth provider has redirected the user back to the application.
// Finish the authentication process by attempting to obtain an access
// token.  If authorization was granted, the user will be logged in.
// Otherwise, authentication has failed.
//app.get('/auth/provider/callback', function(req, res, next) {
//	passport.authenticate('provider', function(err, user, info) {
//		if (err) { return next(err); }
//		if (!user) { return res.redirect('/auth/provider'); }
//		req.logIn(user, function(err) {
//			if (err) { return next(err); }
//			return res.redirect(req.session.authReturnUrl ? req.session.authReturnUrl : '/');
//		});
//	})(req, res, next);
//});

app.get('/auth/provider/callback',
	passport.authenticate('provider', { successRedirect: '/',
		failureRedirect: '/login' })
);

var server = app.listen(config.port, function () {

	var host = server.address().address;
	var port = server.address().port;

	console.log('Example app listening at http://%s:%s', host, port);

});