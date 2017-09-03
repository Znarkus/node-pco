"use strict";

var Promise = require('bluebird');
var request = require('request');
var _ = require('lodash');
var debug = require('debug')('lib');
var people = {};
var oauthClient;

module.exports = function (_oauthClient) {
	oauthClient = _oauthClient;

	return {
		fillListWithPersonData: fillListWithPersonData,
		loadPerson: loadPerson,
		callApi: callApi,
		auth: auth,
		promisesForEachParallel: promisesForEachParallel
	};
};

function fillListWithPersonData(user, items) {
	return load(0);

	function load(index) {
		if (items[index]) {
			return loadPerson(user, items[index].person_id).then(function(person) {
				items[index].person = person;

				if (index + 1 < items.length) {
					return load(index + 1);
				}
			})
		} else {
			debug('Index %s is missing from:\n%j', index, items);
		}
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
			// debug(body);
			body = JSON.parse(body);
			//console.log(body);
			resolve(body);
		});
	});
}

function auth(req, res, next) {
	if (req.user) {
		next();
	} else {
		req.session.authReturnUrl = req.originalUrl;
		res.redirect('/auth/provider');
	}
}

function promisesForEachParallel(items, iteratorCb) {
	var promises = [];

	_.forEach(items, function(item, key) {
		promises.push(iteratorCb(item, key));
	});

	return Promise.all(promises);
}