'use strict';

const debugCreate = require('debug'),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:branch');

/**
 * Handles an branch message.
 * @param {Object} data The message data.
 * @param {Boolean} beforeZero Indicates whether the before hash is all zeroes.
 * @param {Boolean} afterZero Indicates whether the after hash is all zeroes.
 * @returns {Promise<Object>} A promise that will be resolved with the output data structure.
 */
module.exports = function (data, beforeZero, afterZero) {
	debug('Handling message...');

	let action = '[unknown]';

	if (beforeZero) {
		action = 'pushed new branch';
	} else if (afterZero) {
		action = 'deleted branch';
	}

	const branch = data.ref.substr(data.ref.lastIndexOf('/') + 1),
		output = {
			parse: 'none',
			text: util.format(
				'[%s] <%s/u/%s|%s> %s <%s/tree/%s|%s>',
				data.repository.name,
				global.config.gitLab.baseUrl,
				data.user_username,
				data.user_username,
				action,
				data.project.web_url,
				branch,
				branch
			)
		};

	debug('Message handled.');

	output.__kind = module.exports.KIND;
	// There's no async in this function, but we have to maintain the contract.
	return Promise.resolve(output);
};

Object.defineProperty(
	module.exports,
	'KIND',
	{
		enumerable: true,
		value: Object.freeze({
			name: 'push',
			title: 'Branch'
		})
	}
);
