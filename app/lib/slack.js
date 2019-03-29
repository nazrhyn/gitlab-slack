'use strict';

const chalk = require('chalk'),
	/**
	 * @type {Configuration}
	 */
	config = require('../../config'),
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
exports.send = async function (body) {
	// Grab the kind metadata and then remove it.
	const kind = body.__kind;
	delete body.__kind;

	debug(chalk`{cyan SEND} -> {blue %s} to webhook`, kind.title);

	try {
		const response = await rp({
			method: 'POST',
			url: config.slackWebhookUrl,
			json: true,
			body,
			resolveWithFullResponse: true
		});

		debug(chalk`{cyan RECV} <- {blue %s} to webhook -> {green %d %s}`, kind.title, response.statusCode, http.STATUS_CODES[response.statusCode]);
	} catch (e) {
		const output = e.response.toJSON(),
			message = output.body.error || output.body.message || output.body;

		const failure = new Error(`Slack Webhook for ${kind.title} - ${message}`);
		failure.statusCode = e.statusCode;

		debug(chalk`{red FAIL} <- {blue %s} to webhook -> {red %d %s} ! %s`, kind.title, failure.statusCode, http.STATUS_CODES[failure.statusCode], message);
		console.log(chalk`{red FAIL} {yellow Request Body ---------------------}`, '\n', util.inspect(body, { colors: supportsColor.stdout.level > 0, depth: 5 }));
		console.log(chalk`{red FAIL} {yellow Response Body ---------------------}`, '\n', util.inspect(output, { colors: supportsColor.stdout.level > 0, depth: 5 }));

		throw failure;
	}
};
