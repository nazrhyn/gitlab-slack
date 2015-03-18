'use strict';

var http = require('http'),
	util = require('util'),
	fs = require('fs'),
	request = require('request'),
	Q = require('q');

var LOG_FILE = 'gitlab-slack.log',
	CONFIG_FILE = 'config.json',
	REGEX_ALL_ZEROES = /^0+$/;

process.on('uncaughtException', function(err) {
	// make sure we at least know what blew up before we quit
	fs.appendFile(LOG_FILE, 'UNCAUGHT EXCEPTION: ' + err.toString());
	process.exit(1);
});

var config,
	logger = new Logger(LOG_FILE),
	server = http.createServer(function(httpreq, httpresp) {
		logger.debug(httpreq, 'Request received.');

		if (httpreq.method == 'POST') {
			var buffers = [];

			httpreq.on('data', function(data) {
				buffers.push(data);
			});

			httpreq.on('end', function() {
				var rawData = Buffer.concat(buffers).toString(),
					data;

				try {
					data = JSON.parse(rawData);
				} catch (e) {
					logger.error(httpreq, e.toString());
					logger.error(httpreq, 'DATA: %s', rawData);

					httpresp.statusCode = 400;
					httpresp.end(http.STATUS_CODES[400]);
				}

				if (data) {
					logger.debug(httpreq, 'DATA: %j', data);

					parseNotification(httpreq, data)
						.catch(function(error) {
							logger.error(httpreq, error);

							httpresp.statusCode = 500;
							httpresp.end(http.STATUS_CODES[500]);
						})
						.then(function() {
							httpresp.end();
						});
				}
			});

		} else {
			httpresp.statusCode = 405;
			httpresp.end(http.STATUS_CODES[405]);
		}
	});

getConfig()
	.then(function(data) {
		config = data;

		logger.debug(null, 'Listening on port %s.', config.port);

		server.listen(config.port);
	})
	.catch(function(err) {
		logger.error(null, 'Unable to read config file. ERROR: %s', err);
	});

// ============================================================================================

/**
 * Gets the configuration from the config file.
 * @returns {Q.Promise} A promise that will be resolved with the configuration data.
 */
function getConfig() {
	var deferred = Q.defer();

	fs.readFile(CONFIG_FILE, { encoding: 'utf8' }, function(err, data) {
		if (err) {
			deferred.reject(err);
		} else {
			deferred.resolve(JSON.parse(data));
		}
	});

	return deferred.promise;
}

/**
 * Parses the raw notification data from the GitLab webhook.
 * @param {Object} httpreq The HTTP request.
 * @param {Object} data The raw notification data.
 * @returns {Q.Promise} A promise that will be resolved when the data is processed.
 */
function parseNotification(httpreq, data) {
	var gitlab = new GitLab(config.gitlab_api_token),
		processed;

	if (data.object_kind) {
		switch (data.object_kind) {
			case 'issue':
				processed = processIssue(httpreq, gitlab, data);
				break;
		}
	} else if (data.ref) {
		if (data.commits) {
			if (REGEX_ALL_ZEROES.test(data.before)) {
				// If before is all zeroes, this is a new branch being pushed.
				processed = processBranch(httpreq, gitlab, data);
			} else {
				processed = processCommit(httpreq, gitlab, data);
			}
		} else {
			processed = processTag(httpreq, gitlab, data);
		}
	}

	if (!processed) {
		processed = processUnrecognized(httpreq, data);
	}

	return processed.then(function(response) {
		if (!response) {
			// If the processing resulted in nothing, it was probably ignored.
			// Return a promise resolved with nothing.
			return Q();
		}

		var deferred = Q.defer();

		request(
			{
				method: 'POST',
				uri: config.slack_webhook_uri,
				json: true,
				body: response
			},
			function (error, response, body) {
				processResponse('slack', error, response, body)
					.then(function(response) {
						deferred.resolve(response);
					})
					.catch(function(error) {
						deferred.reject(error);
					});
			}
		);

		return deferred.promise;
	});
}

/**
 * Processes an issue message.
 * @param {Object} httpreq      The HTTP request.
 * @param {GitLab} gitlab       An instance of the GitLab API wrapper.
 * @param {Object} issueData    The issue message data.
 * @returns {Q.Promise} A promise that will be resolved with the slack response.
 */
function processIssue(httpreq, gitlab, issueData) {
	var issueDetails = issueData.object_attributes;

	if (issueDetails.action === 'update') {
		// If this is a modify, ignore it. We don't want the spam.
		// Return a promise resolved with nothing.
		return Q();
	}

	logger.debug(httpreq, 'PROCESS: Issue');

	return Q.spread(
		[
			gitlab.getProject(issueDetails.project_id),
			gitlab.getUserById(issueDetails.author_id),
			// Assignee can be null, so don't try to fetch details it if it is.
			issueDetails.assignee_id ? gitlab.getUserById(issueDetails.assignee_id) : Q.resolve(null)
		],
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
				assigneeName = util.format('<https://***REMOVED***/u/%s|%s>', assignee.username, assignee.username)
			}

			text = util.format(
				'[%s] issue #%s %s by <https://***REMOVED***/u/%s|%s> — *assignee:* %s — *creator:* <https://***REMOVED***/u/%s|%s>',
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
				parse: 'none',
				text: text,
				attachments: [
					{
						fallback: util.format(
							'#%s %s\r\n%s',
							issueDetails.iid,
							issueDetails.title,
							issueDetails.description
						),
						title: util.format(
							'<%s|%s>',
							issueDetails.url,
							// Allow people use < & > in their titles.
							issueDetails.title.replace('<', '&lt;').replace('>', '&gt;')
						),
						text: issueDetails.description,
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
 * Processes a new branch message.
 * @param {Object} httpreq      The HTTP request.
 * @param {GitLab} gitlab       An instance of the GitLab API wrapper.
 * @param {Object} branchData   The branch message data.
 * @returns {Q.Promise} A promise that will be resolved with the slack response.
 */
function processBranch(httpreq, gitlab, branchData) {
	logger.debug(httpreq, 'PROCESS: Branch');

	return Q.spread(
		// Resolve the project ID and user ID to get more info.
		[gitlab.getProject(branchData.project_id), gitlab.getUserById(branchData.user_id)],
		function(project, user) {
			var channel = config.project_channel_map[project.id.toString()],
				branch = branchData.ref.substr(branchData.ref.lastIndexOf('/') + 1),
				response = {
					parse: 'none',
					text: util.format(
						'[%s] <https://***REMOVED***/u/%s|%s> pushed new branch <%s/tree/%s|%s>',
						project.path,
						user.username,
						user.username,
						project.web_url,
						branch,
						branch
					)
				};

			if (channel) {
				response.channel = channel;
			}

			return response;
		}
	);
}

/**
 * Processes a commit message.
 * @param {Object} httpreq      The HTTP request.
 * @param {GitLab} gitlab       An instance of the GitLab API wrapper.
 * @param {Object} commitData   The commit message data.
 * @returns {Q.Promise} A promise that will be resolved with the slack response.
 */
function processCommit(httpreq, gitlab, commitData) {
	logger.debug(httpreq, 'PROCESS: Commit');

	// Resolve the project ID and user ID to get more info.
	var calls = [gitlab.getProject(commitData.project_id), gitlab.getUserById(commitData.user_id)];

	// Also resolve each commit's user by email address.
	commitData.commits.forEach(function(c) {
		calls.push(gitlab.searchUser(c.author.email));
	});

	return Q.spread(calls, function(project, user) {
		var channel = config.project_channel_map[project.id.toString()],
			attachment = {
				color: '#317CB9',
				mrkdwn_in: ['text']
			},
			response = {
				parse: 'none',
				text: util.format(
					'[%s:%s] %s new commits by <https://***REMOVED***/u/%s|%s>:',
					project.path,
					commitData.ref.substr(commitData.ref.lastIndexOf('/') + 1),
					commitData.total_commits_count,
					user.username,
					user.username
				),
				attachments: [attachment]
			},
			attachmentFallbacks = [],
			attachmentTexts = [];

		for (var i = 0; i < commitData.commits.length; i++) {
			var commit = commitData.commits[i],
				commitUser = arguments[i + 2][0], // all parameters after the static ones are commit users
				commitId = commit.id.substr(0, 8),
				message = commit.message.split(/(?:\r\n|[\r\n])/)[0];

			if (!commitUser) {
				// If the user couldn't be resolved, use the email in its place.
				commitUser = {
					username: commit.author.email
				}
			}

			attachmentFallbacks.push(util.format(
				'[%s] %s: %s',
				commitUser.username,
				commitId,
				message
			));

			attachmentTexts.push(util.format(
				'[%s] <%s|%s>: %s',
				commitUser.username,
				commit.url,
				commitId,
				message
			));
		}

		attachment.fallback = attachmentFallbacks.join('\r\n');
		attachment.text = attachmentTexts.join('\r\n');

		if (channel) {
			response.channel = channel;
		}

		return response;
	});
}

/**
 * Processes a tag message.
 * @param {Object} httpreq The HTTP request.
 * @param {GitLab} gitlab An instance of the GitLab API wrapper.
 * @param {Object} tagData The tag message data.
 * @returns {Q.Promise} A promise that will be resolved with the slack response.
 */
function processTag(httpreq, gitlab, tagData) {
	logger.debug(httpreq, 'PROCESS: Tag');

	return Q.spread(
		// Resolve the project ID and user ID to get more info.
		[gitlab.getProject(tagData.project_id), gitlab.getUserById(tagData.user_id)],
		function(project, user) {
			var channel = config.project_channel_map[project.id.toString()],
				tag = tagData.ref.substr(tagData.ref.lastIndexOf('/') + 1),
				response = {
					text: util.format(
						'[%s] <https://***REMOVED***/u/%s|%s> pushed tag <%s/commits/%s|%s>',
						project.path,
						user.username,
						user.username,
						project.web_url,
						tag,
						tag
					)
				};

			if (channel) {
				response.channel = channel;
			}

			return response;
		}
	);
}

/**
 * Processes an unrecognized message.
 * @param {Object} httpreq  The HTTP request.
 * @param {Object} data     The unrecognized data.
 * @returns {Q.Promise} A promise resolved with the unrecognized data.
 */
function processUnrecognized(httpreq, data) {
	logger.debug(httpreq, 'PROCESS: Unrecognized');

	// Post anything unrecognized raw to a DM.
	var dataString = JSON.stringify(data, null, 4),
		response = {
			parse: 'none',
			channel: '@harwood',
			attachments: [{
				title: 'GitLab Webhook - Unrecognized Data',
				fallback: dataString,
				text: '```' + dataString + '```',
				color: 'danger',
				mrkdwn_in: ['text']
			}]
		};

	// just return a promise resolved with this value
	return Q(response);
}

/**
 * Processes the response from a request.
 * @param {String} source               The response source.
 * @param {*} error                     The error.
 * @param {IncomingMessage} response    The response.
 * @param {String|Object} body          The response body.
 * @returns {Q.Promise} A promise resolved or rejected depending on the properties of the response.
 */
function processResponse(source, error, response, body) {
	var deferred = Q.defer();

	if (error) {
		deferred.reject(source.toUpperCase() + ': HTTP' + response.statusCode + ' -- ' + error);
	} else if (response.statusCode < 200 || response.statusCode > 299) {
		if (response.headers['content-length'] <= 250) {
			if (typeof(body) !== 'string') {
				body = JSON.stringify(body);
			}

			deferred.reject(source.toUpperCase() + ': HTTP' + response.statusCode + ' -- ' + body);
		} else {
			deferred.reject(source.toUpperCase() + ': HTTP' + response.statusCode + ' -- ' + http.STATUS_CODES[response.statusCode]);
		}
	} else {
		deferred.resolve(body);
	}

	return deferred.promise;
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
	 * @param {String} level        The log level.
	 * @param {Object} [httpreq]    The associated HTTP request.
	 * @param {String} format       The log entry format.
	 * @param {*...} args           The format arguments.
	 */
	this.log = function(level, httpreq, format, args) {
		var formatArgs = [],
			httpinfo = '';

		for (var i = 2; i < arguments.length; i++) {
			if (arguments[i]) formatArgs.push(arguments[i]);
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
	 * @param {Object} [httpreq]    The associated HTTP request.
	 * @param {String} format       The log entry format.
	 * @param {*...} args           The format arguments.
	 */
	this.debug = function(httpreq, format, args) {
		this.log('DEBUG', httpreq, format, args);
	};

	/**
	 * Writes an error entry to the log file.
	 * @param {Object} [httpreq]    The associated HTTP request.
	 * @param {String} format       The log entry format.
	 * @param {*...} args           The format arguments.
	 */
	this.error = function(httpreq, format, args) {
		this.log('ERROR', httpreq, format, args);
	};
}

/**
 * Wrapper for the GitLab API.
 * @param {String} token GitLab token.
 * @constructor
 */
function GitLab(token) {
	var BASE_URI = 'https://***REMOVED***/api/v3';

	/**
	 * Gets user information by ID.
	 * @param {String|Number} id The user ID.
	 * @returns {Q.Promise} A promise that will be resolved with the user information.
	 */
	this.getUserById = function(id) {
		return sendRequest(BASE_URI + '/users/:id'.replace(':id', id));
	};

	/**
	 * Searches for a user by email address.
	 * @param {String} email User email address.
	 * @returns {Q.Promise} A promise that will be resolved with a list of matching users.
	 */
	this.searchUser = function(email) {
		return sendRequest(BASE_URI + '/users?search=' + email);
	};

	/**
	 * Gets project information by ID.
	 * @param {String|Number} id The project ID.
	 * @returns {Q.Promise} A promise that will be resolved with the project information.
	 */
	this.getProject = function(id) {
		return sendRequest(BASE_URI + '/projects/:id'.replace(':id', id));
	};

	/**
	 * Sends a request to the GitLab API.
	 * @param {String} uri The URI.
	 * @param {String} [method] The HTTP method. Default = GET
	 * @returns {Q.Promise} A promise that will be resolved with the response body.
	 */
	function sendRequest(uri, method) {
		var deferred = Q.defer();

		if (!method) {
			method = 'GET';
		}

		request(
			{
				method: method,
				uri: uri,
				headers: {
					'PRIVATE-TOKEN': token
				},
				json: true,
				rejectUnauthorized: false
			},
			function (error, response, body) {
				processResponse('gitlab', error, response, body)
					.then(function(response) {
						deferred.resolve(response);
					})
					.catch(function(error) {
						deferred.reject(error);
					});
			}
		);

		return deferred.promise;
	}
}