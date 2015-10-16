'use strict';

global._ = require('underscore');
global.Promise = require('bluebird');

var http = require('http'),
	util = require('util'),
	fs = require('fs'),
	request = Promise.promisify(require('request'));

var readFile = Promise.promisify(fs.readFile),
	LOG_FILE = 'gitlab-slack.log',
	CONFIG_FILE = 'config.json',
	REGEX_ALL_ZEROES = /^0+$/,
	REGEX_MARKDOWN_LINK = /!?\[([^\]]*)]\(([^)]+)\)/g,
	REGEX_MARKDOWN_BOLD = /(\*\*|__)(.*?)\1/g,
	REGEX_MARKDOWN_ITALIC = /(\*|_)(.*?)\1/g,
	REGEX_MARKDOWN_BULLET = /^([ \t]+)?\*/mg,
	REGEX_MARKDOWN_HEADER = /^#+(.+)$/mg,
	REGEX_ISSUE_MENTION = /#\d+/g;

process.on('uncaughtException', function(err) {
	// Make sure we at least know what blew up before we quit.
	fs.appendFileSync(LOG_FILE, 'UNCAUGHT EXCEPTION: ' + err.toString() + '\n' + err.stack);
	process.exit(1);
});

/**
 * @type {Configuration}
 */
var config,
	gitlab,
	logger = new Logger(LOG_FILE),
	server = http.createServer(function(req, res) {
		logger.debug(req, 'Request received.');

		if (req.method === 'POST') {
			var buffers = [];

			req.on('data', function(data) {
				buffers.push(data);
			});

			req.on('end', function() {
				var rawData = Buffer.concat(buffers).toString(),
					data;

				try {
					data = JSON.parse(rawData);
				} catch (e) {
					logger.error(req, e.toString());
					logger.error(req, 'DATA: %s', rawData);

					res.statusCode = 400;
					res.end(http.STATUS_CODES[400]);
				}

				if (data) {
					logger.debug(req, 'DATA: %j', data);

					parseNotification(req, data)
						.then(function() {
							res.end();
						})
						.catch(function(error) {
							logger.error(req, error);

							res.statusCode = 500;
							res.end(http.STATUS_CODES[500]);
						})
						.done();
				}
			});

		} else {
			res.statusCode = 405;
			res.end(http.STATUS_CODES[405]);
		}
	});

readFile(CONFIG_FILE, { encoding: 'utf8' }).then(function(contents) {

	config = JSON.parse(contents);

	// Initialize the gitlab API wrapper.
	gitlab = new GitLab(config.gitlab_api_base_url, config.gitlab_api_token);

	logger.debug(null, 'Listening on port %s.', config.port);

	server.listen(config.port);
}).catch(function(err) {
	logger.error(null, 'Unable to read config file. ERROR: %s', err);
});

// ============================================================================================

/**
 * Parses the raw notification data from the GitLab webhook.
 * @param {Object} httpreq The HTTP request.
 * @param {Object} data The raw notification data.
 * @returns {Promise} A promise that will be resolved when the data is processed.
 */
function parseNotification(httpreq, data) {
	var processed;

	if (data.object_kind) {
		switch (data.object_kind) {
			case 'issue':
				processed = processIssue(httpreq, data);
				break;
			case 'push':
				var beforeZero = REGEX_ALL_ZEROES.test(data.before),
					afterZero = REGEX_ALL_ZEROES.test(data.after);

				if (beforeZero || afterZero) {
					// If before or after is all zeroes, this is a branch being pushed.
					processed = processBranch(httpreq, data, beforeZero, afterZero);
				} else {
					processed = processCommit(httpreq, data);
				}
				break;
			case 'tag_push':
				processed = processTag(httpreq, data);
				break;
		}
	}

	if (!processed) {
		processed = processUnrecognized(httpreq, data);
	}

	return processed.then(function(response) {
		if (!response) {
			// If the processing resulted in nothing, it was probably ignored.
			return;
		}

		return request({
			method: 'POST',
			uri: config.slack_webhook_url,
			json: true,
			body: response
		}).catch(function (err) {
			return processError('slack', err);
		}).spread(function (response, body) {
			return processResponse('slack', response, body);
		});
	});
}

/**
 * Processes an issue message.
 * @param {Object} httpreq      The HTTP request.
 * @param {Object} issueData    The issue message data.
 * @returns {Q.Promise} A promise that will be resolved with the slack response.
 */
function processIssue(httpreq, issueData) {
	var issueDetails = issueData.object_attributes;

	if (issueDetails.action === 'update') {
		// If this is a modify, ignore it. We don't want the spam.
		// Return a promise resolved with nothing.
		return Promise.resolve();
	}

	logger.debug(httpreq, 'PROCESS: Issue');

	return Promise.join(
		gitlab.getProject(issueDetails.project_id),
		gitlab.getUserById(issueDetails.author_id),
		// Assignee can be null, so don't try to fetch details it if it is.
		issueDetails.assignee_id ? gitlab.getUserById(issueDetails.assignee_id) : Promise.resolve(null),
		function(project, author, assignee) {
			var channel = config.project_channel_map[project.id.toString()],
				verb;

			switch (issueDetails.action) {
				case 'open':
					verb = 'created';
					break;
				case 'reopen':
					verb = 're-opened';
					break;
				case 'update':
					verb = 'modified';
					break;
				case 'close':
					verb = 'closed';
					break;
				default:
					verb = '(' + issueDetails.action + ')';
					break;
			}

			var assigneeName = '_none_',
				text;

			if (assignee) {
				assigneeName = util.format('<https://git.lab.teralogics.com/u/%s|%s>', assignee.username, assignee.username);
			}

			text = util.format(
				'[%s] issue #%s %s by <https://git.lab.teralogics.com/u/%s|%s> — *assignee:* %s — *creator:* <https://git.lab.teralogics.com/u/%s|%s>',
				project.path,
				issueDetails.iid,
				verb,
				issueData.user.username,
				issueData.user.username,
				assigneeName,
				author.username,
				author.username
			);

			var response = {
				text: text,
				attachments: [
					{
						fallback: util.format(
							'#%s %s\n%s',
							issueDetails.iid,
							issueDetails.title,
							issueDetails.description
						),
						title: issueDetails.title.replace('<', '&lt;').replace('>', '&gt;'), // Allow people use < & > in their titles.
						title_link: issueDetails.url,
						text: formatIssueDescription(issueDetails.description),
						color: '#F28A2B',
						mrkdwn_in: ['title', 'text']
					}
				]
			};

			if (channel) {
				response.channel = channel;
			}

			return response;
		}
	);
}

/**
 * Converts Markdown links, bullets, bold and italic to Slack style formatting.
 * @param {String} description The description.
 * @returns {String} The formatted description.
 */
function formatIssueDescription(description) {
	return description
		.replace(REGEX_MARKDOWN_BULLET, function (match, indent) {
			// If the indent is present, replace it with a tab.
			return (indent ? '\t' : '') + '•';
		})
		.replace(REGEX_MARKDOWN_LINK, '<$2|$1>')
		.replace(REGEX_MARKDOWN_ITALIC, '_$2_')
		.replace(REGEX_MARKDOWN_BOLD, '*$2*')
		.replace(REGEX_MARKDOWN_HEADER, '*$1*');
}

/**
 * Processes a new branch message.
 * @param {Object} httpreq      The HTTP request.
 * @param {Object} branchData   The branch message data.
 * @param {Boolean} beforeZero	Indicates whether the `before` hash is all zeroes.
 * @param {Boolean} afterZero	Indicates whether the `after` hash is all zeroes.
 * @returns {Q.Promise} A promise that will be resolved with the slack response.
 */
function processBranch(httpreq, branchData, beforeZero, afterZero) {
	logger.debug(httpreq, 'PROCESS: Branch');

	var action = '[unknown]';

	if (beforeZero) {
		action = 'pushed new branch';
	} else if (afterZero) {
		action = 'deleted branch';
	}

	// Resolve the project ID and user ID to get more info.
	return Promise.join(gitlab.getProject(branchData.project_id), gitlab.getUserById(branchData.user_id), function (project, user) {
		var channel = config.project_channel_map[project.id.toString()],
			branch = branchData.ref.substr(branchData.ref.lastIndexOf('/') + 1),
			response = {
				parse: 'none',
				text: util.format(
					'[%s] <https://git.lab.teralogics.com/u/%s|%s> %s <%s/tree/%s|%s>',
					project.path,
					user.username,
					user.username,
					action,
					project.web_url,
					branch,
					branch
				)
			};

		if (channel) {
			response.channel = channel;
		}

		return response;
	});
}

/**
 * Processes a commit message.
 * @param {Object} httpreq      The HTTP request.
 * @param {Object} commitData   The commit message data.
 * @returns {Promise} A promise that will be resolved with the slack response.
 */
function processCommit(httpreq, commitData) {
	logger.debug(httpreq, 'PROCESS: Commit');

	// Resolve the project ID and user ID to get more info.
	var calls = [gitlab.getProject(commitData.project_id), gitlab.getUserById(commitData.user_id)];

	// Also resolve each commit's user by email address.
	commitData.commits.forEach(function(c) {
		calls.push(gitlab.searchUser(c.author.email).then(function (results) {
			// Take the first matching result.
			if (results.length > 0) {
				return results[0];
			} else {
				return null;
			}
		}));
	});

	return Promise.all(calls).spread(function(project, user) {
		var channel = config.project_channel_map[project.id.toString()],
			attachment = {
				color: '#317CB9',
				mrkdwn_in: ['text']
			},
			response = {
				parse: 'none',
				text: util.format(
					'[%s:%s] <https://git.lab.teralogics.com/u/%s|%s> pushed %s new commits:',
					project.path,
					commitData.ref.substr(commitData.ref.lastIndexOf('/') + 1),
					user.username,
					user.username,
					commitData.total_commits_count
				),
				attachments: [attachment]
			},
			attachmentFallbacks = [],
			attachmentTexts = [],
			// I'm not super worried about V8 optimization in this project.
			commitUsers = Array.prototype.slice.call(arguments, 2);

		_.each(commitData.commits, function (commit, index) {
			var commitUser = commitUsers[index], // all parameters after the static ones are commit users
				commitUserName,
				commitId = commit.id.substr(0, 8), // only the first 8 characters of the commit hash are needed
				message = commit.message.split(/(?:\r\n|[\r\n])/)[0], // only print the first line; support all line ending types
				issues = commit.message.match(REGEX_ISSUE_MENTION), // find all issue mentions
				issuesSuffix = '';

			if (commitUser) {
				commitUserName = commitUser.username;
			} else {
				// If the username couldn't be resolved, use the email in its place.
				commitUserName = commit.author.email;
			}

			if (issues) {
				// If there were issues, build the fallback suffix here.
				issuesSuffix = ' (' + issues.join(', ') + ')';
			}

			attachmentFallbacks.push(util.format(
				'[%s] %s: %s',
				commitUserName,
				commitId,
				message + issuesSuffix
			));

			if (issues) {
				// If there were issues, build the formatted suffix here.
				issues = _.map(issues, function (issue) {
					return util.format(
						'<%s|%s>',
						commitData.repository.homepage + '/issues/' + issue.substr(1),
						issue
					);
				});

				issuesSuffix = ' (' + issues.join(', ') + ')';
			}

			attachmentTexts.push(util.format(
				'[%s] <%s|%s>: %s',
				commitUserName,
				commit.url,
				commitId,
				message + issuesSuffix
			));
		});

		attachment.fallback = attachmentFallbacks.join('\n');
		attachment.text = attachmentTexts.join('\n');

		if (channel) {
			response.channel = channel;
		}

		return response;
	});
}

/**
 * Processes a tag message.
 * @param {Object} httpreq The HTTP request.
 * @param {Object} tagData The tag message data.
 * @returns {Promise} A promise that will be resolved with the slack response.
 */
function processTag(httpreq, tagData) {
	logger.debug(httpreq, 'PROCESS: Tag');

	// tags work like branches; before zero is add, after zero is delete
	var beforeZero = REGEX_ALL_ZEROES.test(tagData.before),
		afterZero = REGEX_ALL_ZEROES.test(tagData.after);

	var action = '[unknown]';

	if (beforeZero) {
		action = 'pushed new tag';
	} else if (afterZero) {
		action = 'deleted tag';
	}

	// Resolve the project ID and user ID to get more info.
	return Promise.join(gitlab.getProject(tagData.project_id), gitlab.getUserById(tagData.user_id), function (project, user) {
		var channel = config.project_channel_map[project.id.toString()],
			tag = tagData.ref.substr(tagData.ref.lastIndexOf('/') + 1),
			response = {
				text: util.format(
					'[%s] <https://git.lab.teralogics.com/u/%s|%s> %s <%s/commits/%s|%s>',
					project.path,
					user.username,
					user.username,
					action,
					project.web_url,
					tag,
					tag
				)
			};

		if (channel) {
			response.channel = channel;
		}

		return response;
	});
}

/**
 * Processes an unrecognized message.
 * @param {Object} httpreq The HTTP request.
 * @param {Object} data The unrecognized data.
 * @returns {Q.Promise} A promise resolved with the unrecognized data.
 */
function processUnrecognized(httpreq, data) {
	logger.debug(httpreq, 'PROCESS: Unrecognized');

	// Post anything unrecognized in raw to the webhook's default channel.
	var dataString = JSON.stringify(data, null, 4),
		response = {
			parse: 'none',
			attachments: [{
				title: 'GitLab Webhook - Unrecognized Data',
				fallback: dataString,
				text: '```' + dataString + '```',
				color: 'danger',
				mrkdwn_in: ['text']
			}]
		};

	// just return a promise resolved with this value
	return Promise.resolve(response);
}

/**
 * Processes the response from a request to determine if it is an error case.
 * @param {String} source The response source.
 * @param {IncomingMessage} response The response.
 * @param {String|Object} body The response body.
 * @returns {Promise} A promise resolved or rejected depending on the properties of the response.
 */
function processResponse(source, response, body) {
	if (response.statusCode < 200 || response.statusCode > 299) {
		var status = source.toUpperCase() + ': HTTP ' + response.statusCode + ' -- ';

		if (body && response.headers['content-length'] <= 500) {
			if (typeof(body) !== 'string') {
				body = JSON.stringify(body);
			}

			status += body;
		} else {
			status += http.STATUS_CODES[response.statusCode];
		}

		return Promise.reject(status);
	} else {
		return Promise.resolve(body);
	}
}

/**
 * Processes an error, preparing it for logging.
 * @param {String} source The error source.
 * @param {*} error The error.
 */
function processError(source, error) {
	return Promise.reject(source.toUpperCase() + ': -- ' + (error.stack || error));
}

/**
 * Log writer.
 * @param {String} filename The path to the file to which to log.
 * @constructor
 */
function Logger(filename) {
	var FORMAT_ENTRY = '[%s](%s)%s -- %s\n',
		FORMAT_HTTP_INFO = ' %s %s';

	/**
	 * Writes an entry to the log file.
	 * @param {String} level The log level.
	 * @param {Object} httpreq The associated HTTP request.
	 * @param {String} format The log entry format.
	 * @param {*...} [args] The format arguments.
	 */
	this.log = function(level, httpreq, format, args) {
		var formatArgs = [],
			httpinfo = '';

		for (var i = 2; i < arguments.length; i++) {
			if (arguments[i]) {
				formatArgs.push(arguments[i]);
			}
		}

		if (httpreq) {
			httpinfo = util.format(FORMAT_HTTP_INFO, httpreq.connection.remoteAddress, httpreq.method);
		}

		var entry = util.format(
			FORMAT_ENTRY,
			new Date().toISOString(),
			level.toUpperCase(),
			httpinfo,
			util.format.apply(this, formatArgs)
		);

		fs.appendFile(filename, entry);
	};

	/**
	 * Writes a debug entry to the log file.
	 * @param {Object} httpreq The associated HTTP request.
	 * @param {String} format The log entry format.
	 * @param {*...} [args] The format arguments.
	 */
	this.debug = function(httpreq, format, args) {
		this.log('DEBUG', httpreq, format, args);
	};

	/**
	 * Writes an error entry to the log file.
	 * @param {Object} httpreq The associated HTTP request.
	 * @param {String} format The log entry format.
	 * @param {*...} [args] The format arguments.
	 */
	this.error = function(httpreq, format, args) {
		this.log('ERROR', httpreq, format, args);
	};
}

/**
 * Wrapper for the GitLab API.
 * @param {String} baseUrl GitLab API base URL.
 * @param {String} token GitLab API token.
 * @constructor
 */
function GitLab(baseUrl, token) {
	/**
	 * Gets user information by ID.
	 * @param {String|Number} id The user ID.
	 * @returns {Promise} A promise that will be resolved with the user information.
	 */
	this.getUserById = function(id) {
		return sendRequest('/users/:id'.replace(':id', id.toString()));
	};

	/**
	 * Searches for a user by email address.
	 * @param {String} email User email address.
	 * @returns {Promise} A promise that will be resolved with a list of matching users.
	 */
	this.searchUser = function(email) {
		return sendRequest('/users?search=' + email);
	};

	/**
	 * Gets project information by ID.
	 * @param {String|Number} id The project ID.
	 * @returns {Promise} A promise that will be resolved with the project information.
	 */
	this.getProject = function(id) {
		return sendRequest('/projects/:id'.replace(':id', id.toString()));
	};

	/**
	 * Sends a request to the GitLab API.
	 * @param {String} url The URL.
	 * @param {String} [method] The HTTP method. Default = GET
	 * @returns {Promise} A promise that will be resolved with the response body.
	 */
	function sendRequest(url, method) {
		if (!method) {
			method = 'GET';
		}

		return request({
			method: method,
			uri: baseUrl + url,
			headers: {
				'PRIVATE-TOKEN': token
			},
			json: true,
			rejectUnauthorized: false
		}).catch(function (err) {
			return processError('gitlab', err);
		}).spread(function (response, body) {
			return processResponse('gitlab', response, body);
		});
	}
}

// ===== TYPES =====

/**
 * GitLab/Slack configuration file.
 * @typedef {Object} Configuration
 * @property {String} slack_webhook_url The URL of the Slack incoming webhook.
 * @property {String} gitlab_api_base_url The GitLab API base URL.
 * @property {String} gitlab_api_token The GitLab API token to use for GitLab API requests.
 * @property {Number} port The port on which to listen.
 * @property {String} project_channel_map An object containing a mapping from GitLab project ID to Slack channel name.
 */
