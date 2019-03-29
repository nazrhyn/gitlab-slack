'use strict';

const debugCreate = require('debug'),
	/**
	 * @type {Configuration}
	 */
	config = require('../../config'),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:branch');

/**
 * Handles an branch message.
 * @param {Object} data The message data.
 * @param {Boolean} beforeZero Indicates whether the before hash is all zeroes.
 * @param {Boolean} afterZero Indicates whether the after hash is all zeroes.
 * @returns {Promise<Object>} A promise that will be resolved with the output data structure.
 */
module.exports = async function (data, beforeZero, afterZero) {
	debug('Handling message...');

	let action = '[unknown]';

	if (beforeZero) {
		action = 'pushed new branch';
	} else if (afterZero) {
		action = 'deleted branch';
	}

	const branch = data.ref.replace('refs/heads/', ''),
		output = {
			parse: 'none',
			text: util.format(
				'[%s] <%s/u/%s|%s> %s <%s/tree/%s|%s>',
				data.project.path_with_namespace,
				config.gitLab.baseUrl,
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

	return output;
};

/**
 * Provides metadata for this kind of handler.
 * @type {HandlerKind}
 */
module.exports.KIND = Object.freeze({
	name: 'push',
	title: 'Branch'
});
