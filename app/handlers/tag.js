'use strict';

const chalk = require('chalk'),
	debugCreate = require('debug'),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:tag');

/**
 * Handles an tag message.
 * @param {Object} data The message data.
 * @param {Boolean} beforeZero Indicates whether the before hash is all zeroes.
 * @param {Boolean} afterZero Indicates whether the after hash is all zeroes.
 * @returns {Promise<Object>} A promise that will be resolved with the output data structure.
 */
module.exports = function (data, beforeZero, afterZero) {
	debug('Handling message...');

	let action = '[unknown]';

	if (beforeZero) {
		action = 'pushed new tag';
	} else if (afterZero) {
		action = 'deleted tag';
	}

	const tag = data.ref.substr(data.ref.lastIndexOf('/') + 1),
		output = {
			text: util.format(
				'[%s] <%s/u/%s|%s> %s <%s/commits/%s|%s>',
				data.repository.name,
				global.config.gitLab.baseUrl,
				data.user_username,
				data.user_username,
				action,
				data.project.web_url,
				tag,
				tag
			)
		};

	if (data.message) {
		// If we have a message, send that along in an attachment.
		output.attachments = [{
			color: module.exports.COLOR,
			text: data.message,
			fallback: data.message
		}];
	}

	debug('Message handled.');

	output.__kind = module.exports.KIND;
	// There's no async in this function, but we have to maintain the contract.
	return Promise.resolve(output);
};

Object.defineProperties(
	module.exports,
	{
		KIND: {
			enumerable: true,
			value: Object.freeze({
				name: 'tag_push',
				title: 'Tag'
			})
		},
		COLOR: {
			enumerable: true,
			value: '#5DB5FD'
		}
	}
);
