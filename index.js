var express = require('express');
var app = express();
var _ = require('lodash');
var hbs = require('hbs');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var passport = require('passport');
var OAuthStrategy = require('passport-oauth').OAuthStrategy;
var moment = require('moment');
var OAuth   = require('oauth-1.0a');
var debug = require('debug')('app');
var util = require('util');
var Path = require('path');
var config = require('./config.json');
var oauthConfig = config.oauth;
var oauthClient = OAuth({
	consumer: {
		public: oauthConfig.consumerKey,
		secret: oauthConfig.consumerSecret
	},
	signature_method: 'HMAC-SHA1'
});
var Lib = require('./lib')(oauthClient);

passport.use('provider', new OAuthStrategy(oauthConfig,
	function(token, tokenSecret, profile, done) {
		//console.log(arguments);
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
app.set('views', Path.resolve(__dirname, 'views'));

hbs.registerHelper('indent_pixels', function(level) {
	return level * 20 + 'px';
});

hbs.registerHelper('debug', function(obj) {
	return JSON.stringify(obj, null, 2);
});

hbs.registerHelper('format_date', function(date, format) {
	return moment(date).format(format);
});

/*app.post('/login',
	passport.authenticate('provider'),
	function(req, res) {
		// If this function gets called, authentication was successful.
		// `req.user` contains the authenticated user.
		res.redirect('/users/' + req.user.username);
	});*/


app.get('/', Lib.auth, function (req, res) {
	listServiceTypes(req.user).then(function (items) {
		res.render('index', { items: items });
	});
});

app.get('/:typeId(\\d+)', Lib.auth, function(req, res) {
	Lib.callApi(req.user, 'GET', 'https://services.planningcenteronline.com/service_types/' + req.params.typeId + '/plans.json').then(function(response) {
		res.render('plans', { items: response });
	});
});

app.get('/:typeId(\\d+)/:planId(\\d+)', Lib.auth, function(req, res) {
	Lib.callApi(req.user, 'GET', 'https://services.planningcenteronline.com/plans/' + req.params.planId + '.json').then(function(response) {
		return [response, Lib.fillListWithPersonData(req.user, response.plan_people)];
	}).spread(function(response) {
		res.render('plan', { data: response });
	});
});

app.get('/sunday', Lib.auth, function(req, res) {
	var sundayDate = req.query.date ? moment(req.query.date, 'YYYY-MM-DD') : moment().day(7);
	var services = [];
	var categoryNames = {};

	var filter = {
		//serviceTypes: req.query.serviceType ? req.query.serviceType.split(',').map(_.parseInt) : [],
		//categoryNames: req.query.categoryName ? req.query.categoryName.toLowerCase().split(',') : [],
		excludePositions: req.query.excludePosition ? req.query.excludePosition.toLowerCase().split(',') : []
	};

	if (req.query.serviceType) {
		filter.serviceTypes = _.isArray(req.query.serviceType) ? req.query.serviceType : [req.query.serviceType];
		filter.serviceTypes = filter.serviceTypes.map(_.parseInt);
	}

	if (req.query.categoryName) {
		filter.categoryNames = _.isArray(req.query.categoryName) ? req.query.categoryName : [req.query.categoryName];
		filter.categoryNames = filter.categoryNames.map(function (v) {
			return v.toLowerCase();
		});
	}

	Lib.promisesForEachParallel(filter.serviceTypes, function(serviceType) {
		return Lib.callApi(req.user, 'GET', 'https://services.planningcenteronline.com/service_types/' + serviceType + '/plans.json?all=true').then(function(response) {
			return Lib.promisesForEachParallel(response, function(service) {
				//var date = new Date(service.sort_date);
				if (sundayDate.isSame(service.sort_date, 'day')) {
					return Lib.callApi(req.user, 'GET', 'https://services.planningcenteronline.com/plans/' + service.id + '.json').then(function(response) {
						services.push(response);
						//Lib.fillListWithPersonData(req.user, response.plan_people, function() {
						//	res.render('plan', { data: response, people: people });
						//});
					});
				}
			});
		})
	}).then(function() {
		return Lib.promisesForEachParallel(services, function(service) {
			service.filteredPeople = [];

			return Lib.promisesForEachParallel(service.plan_people, function(person) {
				var includeCategory = _.indexOf(filter.categoryNames, person.category_name.toLowerCase()) > -1;

				categoryNames[person.category_name] = { name: person.category_name, selected: includeCategory };

				if (includeCategory) {
					if (_.indexOf(filter.excludePositions, person.position.toLowerCase().trim()) == -1) {
						if (person.status != 'D') {
							service.filteredPeople.push(person);
						}
					}
				}
			});
		});
	}).then(function() {
		return Lib.promisesForEachParallel(services, function(service) {
			return Lib.fillListWithPersonData(req.user, service.filteredPeople);
		});
	}).then(function() {
		return listServiceTypes(req.user);
	}).then(function(serviceTypes) {
		var filteredEmails = [];
		//var missingEmail = [];

		_.forEach(serviceTypes, function (type) {
			type.selected = filter.serviceTypes.indexOf(type.id) > -1;
		});

		_.forEach(services, function (service) {
			_.forEach(service.filteredPeople, function (person) {
				person.display_service_time = person.position_display_times && service.service_times.length > 1;

				// Extract emails
				_.forEach(person.person.contact_data.email_addresses, function (email) {
					filteredEmails.push(email.address);
				});
			});
		});

		services = _.sortBy(services, 'sort_date');

		res.render('sunday', {
			services: services,
			serviceTypes: serviceTypes,
			sundayDate: sundayDate,
			categoryNames: categoryNames,
			filteredEmails: _.uniq(filteredEmails),
			query: req.query
		});
	});
});

// Redirect the user to the OAuth provider for authentication.  When
// complete, the provider will redirect the user back to the application at
//     /auth/provider/callback
app.get('/auth/provider', passport.authenticate('provider'));

// The OAuth provider has redirected the user back to the application.
// Finish the authentication process by attempting to obtain an access
// token.  If authorization was granted, the user will be logged in.
// Otherwise, authentication has failed.
app.get('/auth/provider/callback', function(req, res, next) {
	passport.authenticate('provider', function(err, user, info) {
		if (err) { return next(err); }
		if (!user) { return res.redirect('/auth/provider'); }
		req.logIn(user, function(err) {
			if (err) { return next(err); }
			return res.redirect(req.session.authReturnUrl ? req.session.authReturnUrl : '/');
		});
	})(req, res, next);
});
//
//app.get('/auth/provider/callback',
//	passport.authenticate('provider', { successRedirect: '/',
//		failureRedirect: '/login' })
//);

var server = app.listen(config.port, function () {

	var host = server.address().address;
	var port = server.address().port;

	console.log('Example app listening at http://%s:%s', host, port);

});

function listServiceTypes(user) {
	return Lib.callApi(user, 'GET', 'https://services.planningcenteronline.com/organization.json').then(function(response) {
		var items = [];

		recurse(response, 0);

		function recurse(level, levelIndex) {
			_.forEach(level.service_types, function(type) {
				//console.log(type);
				type.level = levelIndex;
				items.push(type);
			});

			_.forEach(level.service_type_folders, function(folder) {
				//console.error(folder);
				folder.level = levelIndex;
				items.push(folder);
				recurse(folder, levelIndex + 1);
			});
		}

		return items;
	});
}