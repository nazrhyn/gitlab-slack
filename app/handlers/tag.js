'use strict';

const debugCreate = require('debug'),
	/**
	 * @type {Configuration}
	 */
	config = require('../../config'),
	util = require('util');

const debug = debugCreate('gitlab-slack:handler:tag');

/**
 * Handles an tag message.
 * @param {Object} data The message data.
 * @param {Boolean} beforeZero Indicates whether the before hash is all zeroes.
 * @param {Boolean} afterZero Indicates whether the after hash is all zeroes.
 * @returns {Promise<Object>} A promise that will be resolved with the output data structure.
 */
module.exports = async function (data, beforeZero, afterZero) {
	debug('Handling message...');

	let action = '[unknown]';

	if (beforeZero) {
		action = 'pushed new tag';
	} else if (afterZero) {
		action = 'deleted tag';
	} else {
		action = 'moved tag';
	}

	const tag = data.ref.replace('refs/tags/', ''),
		output = {
			text: util.format(
				'[%s] <%s/u/%s|%s> %s <%s/commits/%s|%s>',
				data.project.path_with_namespace,
				config.gitLab.baseUrl,
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

	return output;
};

/**
 * Provides metadata for this kind of handler.
 * @type {HandlerKind}
 */
module.exports.KIND = Object.freeze({
	name: 'tag_push',
	title: 'Tag'
});

/**
 * The color for this kind of handler.
 * @type {string}
 */
module.exports.COLOR = '#5DB5FD';
