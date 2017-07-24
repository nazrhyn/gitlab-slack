'use strict';

const chalk = require('chalk'),
	debugCreate = require('debug'),
	http = require('http'),
	rp = require('request-promise'),
	util = require('util');

const debug = debugCreate('gitlab-slack:slack');

/**
 * Sends data to the Slack webhook.
 * @param {Object} body The data.
 * @returns {Promise} A promise that will be resolved when the data is sent.
 */
exports.send = function (body) {
	// Grab the kind metadata and then remove it.
	const kind = body.__kind;
	delete body.__kind;

	debug(chalk`{cyan SEND} -> {blue %s} to webhook`, kind.title);

	return rp({
		method: 'POST',
		url: global.config.slackWebhookUrl,
		json: true,
		body,
		resolveWithFullResponse: true
	})
		.promise() // Convert to Bluebird promise.
		.then(function (response) {
			debug(chalk`{cyan RECV} <- {blue %s} to webhook -> {green %d %s}`, kind.title, response.statusCode, http.STATUS_CODES[response.statusCode]);
		})
		.catch(function (err) {
			const output = err.response.toJSON(),
				message = output.body.error || output.body.message || output.body;

			const failure = new Error(`Slack Webhook for ${kind.title} - ${message}`);
			failure.statusCode = err.statusCode;

			debug(chalk`{red FAIL} <- {blue %s} to webhook -> {red %d %s} ! %s`, kind.title, failure.statusCode, http.STATUS_CODES[failure.statusCode], message);
			console.log(chalk`{red FAIL} {yellow Request Body ---------------------}`, '\n', util.inspect(body, { colors: true, depth: 5 }));
			console.log(chalk`{red FAIL} {yellow Response Body ---------------------}`, '\n', util.inspect(output, { colors: true, depth: 5 }));

			throw failure;
		});
};
