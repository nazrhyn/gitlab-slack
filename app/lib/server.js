'use strict';

const chalk = require('chalk'),
	debugCreate = require('debug'),
	http = require('http'),
	util = require('util');

const debug = debugCreate('gitlab-slack:server');

/**
 * Creates the HTTP server that handles webhooks.
 * @param {function(Object)} dataCallback The data callback.
 * @returns {http.Server} The HTTP server.
 */
exports.createServer = function (dataCallback) {
	debug('Creating server...');
	const server = http.createServer(function (req, res) {
		debug(
			chalk`{cyan RECV} -> {blue %s} - %s {gray %s}`,
			req.headers['x-forwarded-for'] || req.connection.remoteAddress,
			req.method,
			req.url
		);

		if (req.method !== 'POST') {
			_sendFailure(res, 405);
			return;
		}

		_handleRequest(req, res, dataCallback);
	});

	const sockets = [];

	/*
	Handle the connection event so that when the server needs to terminate, we can
	 manually destroy every remaining socket that's still open.
	If we dont' do this, we have to wait for those socket connections to time out
	 before the server will actually close.
	 */
	server.on('connection', function (socket) {
		sockets.push(socket);

		socket.on('close', function () {
			_.pull(sockets, socket);
		});
	});

	server.on('error', function (error) {
		debug(chalk`{red ERROR} {redBright %s} ! %s`, error.code || 'UNKNOWN', error.message);

		// If we get a server error, just assume that we should close the server.
		server.close();
	});

	server.on('listening', function () {
		const address = server.address();

		debug(chalk`Server listening on port {blue ${address.port}}.`);
	});

	server.on('close', function () {
		debug('Server closed.');
	});

	/*
	Wrap the close function to destroy all remaining sockets before calling the
	 real close function.
	 */
	const _close = server.close;
	server.close = function (cb) {
		for (const socket of sockets) {
			socket.destroy();
		}

		_close.call(server, cb);
	};

	return server;
};

// region ---- HELPER FUNCTIONS --------------------

/**
 * Sends a failure response.
 * @param {http.ServerResponse} res The response.
 * @param {Number} statusCode The status code.
 * @param {String} [message] The message. (default = status code text)
 * @private
 */
function _sendFailure(res, statusCode, message) {
	const output = message || http.STATUS_CODES[statusCode];

	res.statusCode = statusCode;
	res.end(output);
	debug(chalk`{cyan SEND} <- {red %d %s}`, res.statusCode, output);
}

/**
 * Handles an incoming request.
 * @param {http.IncomingMessage} req The request.
 * @param {http.ServerResponse} res The response.
 * @param {function(Object)} dataCallback The data callback.
 * @private
 */
function _handleRequest(req, res, dataCallback) {
	const buffers = [];

	let totalLength = 0;

	req.on('data', function (buffer) {
		buffers.push(buffer);
		totalLength += buffer.length;
	});

	req.on('end', function () {
		let body = Buffer.concat(buffers, totalLength).toString();

		try {
			body = JSON.parse(body);
		} catch (e) {
			debug(chalk`{red FAIL} Could not JSON parse body. ! {red %s}${'\n'}     {blue Body} %s`, e.message, body);
			_sendFailure(res, 400);
			return;
		}

		let handle;

		try {
			handle = dataCallback(body);
		} catch (e) {
			debug(chalk`{red FAIL} Failed calling data handler. ! {red %s}`, e.message);
			console.log(chalk`{red FAIL} {yellow Stack Trace ----------------------}`, '\n', e.stack);
			console.log(chalk`{red FAIL} {yellow Message Body ---------------------}`, '\n', util.inspect(body, { colors: true, depth: 5 }));
			_sendFailure(res, 500);
			return;
		}

		const handleThen = handle.then;
		if (!handleThen || !_.isFunction(handleThen)) {
			// If the data callback doesn't return a promise, that's a programmer error; kill it with fire.
			throw new Error('Server data callback must return a promise.');
		}

		handleThen.call(handle, function () {
			res.statusCode = 200;
			res.end();
			debug(chalk`{cyan SEND} <- {green %d %s}`, res.statusCode, http.STATUS_CODES[res.statusCode]);
		})
			.catch(function (err) {
				debug(chalk`{red FAIL} Failed handling data. ! {red %s}`, err.message);
				console.log(chalk`{red FAIL} {yellow Stack Trace ----------------------}`, '\n', err.stack);
				console.log(chalk`{red FAIL} {yellow Message Body ---------------------}`, '\n', util.inspect(body, { colors: true, depth: 5 }));
				_sendFailure(res, 500);
			});
	});
}

// endregion ---- HELPER FUNCTIONS --------------------
