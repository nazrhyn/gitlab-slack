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
	REGEX_MARKDOWN_IMAGE_LINK = /!\[([^\]]*)]\(([^)]+)\)/g,
	REGEX_MARKDOWN_LINK = /\[([^\]]*)]\(([^)]+)\)/g,
	REGEX_MARKDOWN_BOLD = /(\*\*|__)(.*?)\1/g,
	REGEX_MARKDOWN_ITALIC = /(\*|_)(.*?)\1/g,
	REGEX_MARKDOWN_BULLET = /^([ \t]+)?\*/mg,
	REGEX_MARKDOWN_HEADER = /^#+(.+)$/mg,
	REGEX_ISSUE_MENTION = /#\d+/g,
	ISSUE_BATCH_FETCH_STEP = 10;

process.on('uncaughtException', function(err) {
	// Make sure we at least know what blew up before we quit.
	fs.appendFileSync(LOG_FILE, 'UNCAUGHT EXCEPTION: ' + err.toString() + '\n' + err.stack);
	process.exit(1);
});

var config,
	gitlab,
	labelCache = {},
	issueCache = {},
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
							logger.error(req, error.stack || error);

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

// I'd like more specific error messages, so that's why the interstitial catches.
readFile(CONFIG_FILE, { encoding: 'utf8' }).catch(function(err) {
	logger.error(null, 'Unable to read config file. ERROR: %s', err.stack || err);
	throw err;
}).then(function(contents) {
	config = JSON.parse(contents);

	// Pre-compile all of the label regexes.
	_.each(config.gitlab.projects, function (project) {
		_.each(project.labels, function (label, index) {
			project.labels[index] = new RegExp(label, "i"); // It's good to be insensitive.
		});
	});

	// Initialize the gitlab API wrapper.
	gitlab = new GitLab(config.gitlab.baseUrl, config.gitlab.api.token);
}).catch(function (err) {
	logger.error(null, 'Unable to parse config file. ERROR: %s', err.stack || err);
	throw err;
}).then(function () {
	return buildIssueLabelCache();
}).catch(function (err) {
	logger.error(null, 'Unable to build issue/label cache. ERROR: %s', err.stack || err);
	throw err;
}).then(function () {
	 logger.debug(null, 'Listening on port %s.', config.port);

	 server.listen(config.port);
}).catch(function (err) {
	logger.error(null, 'Unable to start service. ERROR: %s', err.stack || err);
});

// ============================================================================================

/**
 * Builds the issue/label cache for each configured project.
 */
function buildIssueLabelCache() {
	var projectCachers = [];

	_.each(config.gitlab.projects, function (project, projectId) {
		if (_.size(project.labels) > 0) {
			// Only cache for projects that have tracked labels defined.
			logger.debug(null, '[CACHE] Caching information for project %s...', projectId);

			// promise.bind(...) can't be used for state, here, due to the discontinuities in the
			//  promise "recursion" that's used to "loop" through all of the cacheable items.
			//  An IIFE will protect the project cache objects from modification after closure.
			var cacher = (function (projectLabels, projectIssues) {
				return gitlab.getLabels(projectId).then(function (labels) {
					var count = 0;

					// Cache only the labels that match the configured label patterns.
					_.chain(labels).filter(function (label) {
						return _.any(project.labels, function (pattern) {
							return pattern.test(label.name);
						});
					}).each(function (label) {
						projectLabels[label.name] = label.color;
						count++;
					});

					logger.debug(null, '[CACHE][%s] Cached %s labels.', projectId, count);

					return cacheProjectIssues(projectIssues, projectId, 1);
				}).then(function () {
					logger.debug(null, '[CACHE][%s] Discovered %s open issues.', projectId, _.keys(projectIssues).length);

					return cacheIssueLabels(projectIssues, projectId, 0);
				}).then(function () {
					logger.debug(null, '[CACHE][%s] Cached all issue label information.', projectId);
				});
			})(labelCache[projectId] = {}, issueCache[projectId] = {});
			// It's only somewhat evil to exploit assignment associativity to pass these...
			//  ...it saves an identifier, amirite?

			projectCachers.push(cacher);
		}
	});

	return Promise.all(projectCachers);
}

/**
 * Gets all of the issues for the specified project and caches them.
 * @param {Object} issueCache The issues cache for this project.
 * @param {Number} projectId The project ID.
 * @param {Number} page The page.
 * @returns {Promise} A promise that will be resolved when all project issues are cached.
 */
function cacheProjectIssues(issueCache, projectId, page) {
	return gitlab.getIssues(projectId, page).each(function (issue) {
		issueCache[issue.id] = true;
	}).then(function (issues) {
		if (issues.length > 0) {
			return cacheProjectIssues(issueCache, projectId, ++page);
		}
	});
}

/**
 * Gets the details for each of the issues in the cache and stores their label information.
 * @param {Object} issueCache The issues cache for this project.
 * @param {Number} projectId The project ID.
 * @param {Number} start The offset within the cache at which to start fetching.
 * @returns {Promise} A promise that will be resolved when all issue label information is cached.
 */
function cacheIssueLabels(issueCache, projectId, start) {
	// Get a batch of issue IDs from `start` to `start + STEP_SIZE`.
	var batch = _.chain(issueCache).keys().rest(start).first(ISSUE_BATCH_FETCH_STEP).value();

	if (batch.length > 0) {
		var gets = [];

		_.each(batch, function (issueId) {
			gets.push(gitlab.getIssue(projectId, issueId));
		});

		return Promise.all(gets).each(function (issue) {
			issueCache[issue.id] = issue.labels;
		}).then(function () {
			return cacheIssueLabels(issueCache, projectId, start + ISSUE_BATCH_FETCH_STEP);
		});
	}

	return Promise.resolve();
}

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
			uri: config.slackWebhookUrl,
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

	logger.debug(httpreq, 'PROCESS: Issue');

	return Promise.join(
		gitlab.getProject(issueDetails.project_id),
		gitlab.getUserById(issueDetails.author_id),
		gitlab.getIssue(issueDetails.project_id, issueDetails.id),
		// Assignee can be null, so don't try to fetch details it if it is.
		issueDetails.assignee_id ? gitlab.getUserById(issueDetails.assignee_id) : Promise.resolve(null),
		function(project, author, issue, assignee) {
			var projectId = project.id.toString(),
				projectConfig = config.gitlab.projects[projectId],
				projectLabelsTracked = !!projectConfig && _.size(projectConfig.labels) > 0,
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

			var projectIssues = issueCache[projectId],
				projectLabels = labelCache[projectId],
				addedLabels,
				removedLabels;

			if (projectLabelsTracked && ['open', 'reopen', 'update'].indexOf(issueDetails.action) !== -1) {
				// If this is open, reopen or update and there are labels tracked for this project,
				//  make sure we care about it before we do anything else.

				addedLabels = _.chain(issue.labels) // Difference between the new label set...
					.difference(projectIssues[issue.id]) // ...and the old label set...
					.intersection(_.keys(projectLabels)) // ...intersected with what we care about.
					.value();

				// Same as above but as old diff. new.
				removedLabels = _.chain(projectIssues[issue.id])
					.difference(issue.labels)
					.intersection(_.keys(projectLabels))
					.value();

				if (issueDetails.action === 'update' && _.size(addedLabels) + _.size(removedLabels) === 0) {
					// If there is no label difference for an update, we do not continue.
					return;
				}
			}

			var assigneeName = '_none_',
				text;

			if (assignee) {
				assigneeName = util.format('<%s/u/%s|%s>', config.gitlab.baseUrl, assignee.username, assignee.username);
			}

			text = util.format(
				'[%s] issue #%s %s by <%s/u/%s|%s> — *assignee:* %s — *creator:* <%s/u/%s|%s>',
				project.path,
				issueDetails.iid,
				verb,
				config.gitlab.baseUrl,
				issueData.user.username,
				issueData.user.username,
				assigneeName,
				config.gitlab.baseUrl,
				author.username,
				author.username
			);

			var response = {
					text: text,
					attachments: []
				},
				mainAttachment = {
					fallback: util.format(
						'#%s %s',
						issueDetails.iid,
						issueDetails.title
					),
					title: issueDetails.title.replace('<', '&lt;').replace('>', '&gt;'), // Allow people use < & > in their titles.
					title_link: issueDetails.url,
					color: '#F28A2B',
					mrkdwn_in: ['title', 'text']
				};

			// Add the main attachment; all action types include some form of this.
			response.attachments.push(mainAttachment);

			switch (issueDetails.action) {
				case 'open':
				case 'reopen':
					// Open and re-open are the only ones that get the full issue description.
					mainAttachment.fallback += '\n' + issueDetails.description;
					mainAttachment.text = formatIssueDescription(issueDetails.description, project.web_url);

					break;
			}

			if (projectLabelsTracked) {
				// This switch handles the label tracking management and reporting stuff.
				switch (issueDetails.action) {
					case 'open':
					case 'reopen':
						// For open or re-open, we start with an empty cache; all labels are newly added.
						projectIssues[issue.id] = [];

					/* falls through */
					case 'update':
						addLabelChangeAttachments(projectLabels, response.attachments, 'Added', addedLabels);
						addLabelChangeAttachments(projectLabels, response.attachments, 'Removed', removedLabels);

						// Now, update the cache to the current state of affairs.
						projectIssues[issue.id] = issue.labels;
						break;
					case 'close':
						// When issues are closed, we remove them from the cache.
						delete projectIssues[issue.id];
						break;
				}
			}

			if (projectConfig && projectConfig.channel) {
				response.channel = projectConfig.channel;
			}

			return response;
		}
	);
}

/**
 * Adds an attachment for each of the labels.
 * @param {Object} projectLabels The label-to-color map for the project.
 * @param {Array} attachments The attachments array.
 * @param {String} action The action.
 * @param {String[]} labels The labels.
 */
function addLabelChangeAttachments(projectLabels, attachments, action, labels) {
	_.each(labels, function (label) {
		attachments.push({
			fallback: util.format('%s label %s', action, label),
			text: util.format('_%s_ label *%s*', action, label),
			color: projectLabels[label],
			mrkdwn_in: ['text']
		});
	});
}

/**
 * Converts Markdown links, bullets, bold and italic to Slack style formatting.
 * @param {String} description The description.
 * @param {String} projectUrl The project web URL.
 * @returns {String} The formatted description.
 */
function formatIssueDescription(description, projectUrl) {
	// Reset the last indices...
	REGEX_MARKDOWN_BULLET.lastIndex =
	REGEX_MARKDOWN_IMAGE_LINK.lastIndex =
	REGEX_MARKDOWN_LINK.lastIndex =
	REGEX_MARKDOWN_ITALIC.lastIndex =
	REGEX_MARKDOWN_BOLD.lastIndex =
	REGEX_MARKDOWN_HEADER.lastIndex = 0;

	return description
		.replace(REGEX_MARKDOWN_BULLET, function (match, indent) {
			// If the indent is present, replace it with a tab.
			return (indent ? '\t' : '') + '•';
		})
		// Image links are sent without the project web URL prefix.
		.replace(REGEX_MARKDOWN_IMAGE_LINK, '<' + projectUrl + '$2|$1>')
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
		var projectConfig = config.gitlab.projects[project.id.toString()],
			branch = branchData.ref.substr(branchData.ref.lastIndexOf('/') + 1),
			response = {
				parse: 'none',
				text: util.format(
					'[%s] <%s/u/%s|%s> %s <%s/tree/%s|%s>',
					project.path,
					config.gitlab.baseUrl,
					user.username,
					user.username,
					action,
					project.web_url,
					branch,
					branch
				)
			};

		if (projectConfig && projectConfig.channel) {
			response.channel = projectConfig.channel;
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
		var email = c.author.email.toLowerCase();

		calls.push(gitlab.searchUser(email).then(function (results) {
			// The user search will do a partial match, so make sure we get the right user.
			//  e.g. smith@a.com -> smith@a.com, highsmith@a.com
			return _.find(results, function (user) {
				return email === user.email.toLowerCase();
			}) || null;
		}));
	});

	return Promise.all(calls).spread(function(project, user) {
		var projectConfig = config.gitlab.projects[project.id.toString()],
			attachment = {
				color: '#317CB9',
				mrkdwn_in: ['text']
			},
			response = {
				parse: 'none',
				text: util.format(
					'[%s:%s] <%s/u/%s|%s> pushed %s new commits:',
					project.path,
					commitData.ref.substr(commitData.ref.lastIndexOf('/') + 1),
					config.gitlab.baseUrl,
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

		if (projectConfig && projectConfig.channel) {
			response.channel = projectConfig.channel;
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
		var projectConfig = config.gitlab.projects[project.id.toString()],
			tag = tagData.ref.substr(tagData.ref.lastIndexOf('/') + 1),
			response = {
				text: util.format(
					'[%s] <%s/u/%s|%s> %s <%s/commits/%s|%s>',
					project.path,
					config.gitlab.baseUrl,
					user.username,
					user.username,
					action,
					project.web_url,
					tag,
					tag
				)
			};

		if (projectConfig && projectConfig.channel) {
			response.channel = projectConfig.channel;
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
		var httpinfo = '';

		if (httpreq) {
			httpinfo = util.format(FORMAT_HTTP_INFO, httpreq.connection.remoteAddress, httpreq.method);
		}

		var entry = util.format(
			FORMAT_ENTRY,
			new Date().toISOString(),
			level.toUpperCase(),
			httpinfo,
			util.format.apply(this, Array.prototype.slice.call(arguments, 2))
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
		this.log.apply(this, ['DEBUG'].concat(Array.prototype.slice.call(arguments)));
	};

	/**
	 * Writes an error entry to the log file.
	 * @param {Object} httpreq The associated HTTP request.
	 * @param {String} format The log entry format.
	 * @param {*...} [args] The format arguments.
	 */
	this.error = function(httpreq, format, args) {
		this.log.apply(this, ['ERROR'].concat(Array.prototype.slice.call(arguments)));
	};
}

/**
 * Wrapper for the GitLab API.
 * @param {String} baseUrl GitLab API base URL.
 * @param {String} token GitLab API token.
 * @constructor
 */
function GitLab(baseUrl, token) {
	// Add the API path prefix to the GitLab base URL.
	baseUrl = baseUrl + config.gitlab.api.basePath;

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
		return sendRequest('/users', {
			search: email
		});
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
	 * Gets issues for a project.
	 * @param {Number} projectId The project ID.
	 * @param {String} [state] The state.
	 * @param {Number} [page] The page. Default = opened
	 * @returns {Promise} A promise that will be resolved with project issues.
	 */
	this.getIssues = function (projectId, state, page) {
		if (_.isNumber(state)) {
			page = state;
			state = undefined;
		}

		if (!state) {
			state = 'opened';
		}

		return sendRequest('/projects/:id/issues'.replace(':id', projectId.toString()), {
			state: state,
			page: page,
			per_page: 50
		});
	};

	/**
	 * Gets an issue.
	 * @param {Number} projectId The project ID.
	 * @param {Number} issueId The issue ID.
	 * @returns {Promise} A promise that will be resolved with the issue.
	 */
	this.getIssue = function (projectId, issueId) {
		return sendRequest('/projects/:pid/issues/:iid'.replace(':pid', projectId.toString()).replace(':iid', issueId.toString()));
	};

	/**
	 * Gets the labels for a project.
	 * @param {Number} projectId The project ID.
	 * @returns {Promise} A promise that will be resolved with project labels.
	 */
	this.getLabels = function (projectId) {
		return sendRequest('/projects/:id/labels'.replace(':id', projectId.toString()));
	};

	/**
	 * Sends a request to the GitLab API.
	 * @param {String} url The URL.
	 * @param {String} [method] The HTTP method. Default = GET
	 * @param {Object} [qs] The query string parameters.
	 * @returns {Promise} A promise that will be resolved with the response body.
	 */
	function sendRequest(url, method, qs) {
		if (_.isObject(method)) {
			qs = method;
			method = undefined;
		}

		if (!method) {
			method = 'GET';
		}

		if (!qs) {
			qs = {};
		}

		return request({
			method: method,
			uri: baseUrl + url,
			qs: qs,
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
