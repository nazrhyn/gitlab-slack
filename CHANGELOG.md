## 1.3.0 / 2015-03-27
* Updated **q** and **request** modules.
* Fixed bug where uncaught exceptions were not being logged.
* Added link/image markdown stripping from issue descriptions. Only the URL will show now.
  * Re-enabled standard parsing mode for the attachment portion of issue notifications.
* Added `.done()` to promise chains where appropriate.
* Updated parser for webhook message schema changes in GitLab 7.9.x.
* Added full support for tag/branch new/delete detection.
* Changed Slack messages to use just line feed (`\n`) rather than carriage return, line feed (`\r\n`).
* Changed issue notification to fill out the attachment's `title_link` instead of putting a manually-constructed link in `title`.

## 1.2.2 / 2015-03-18
* Added assignee to issue notifications.
* Fixed bug that prevented notification when there was no GitLab user matching the commit email.
* Changed to single-quoted strings.

## 1.2.1 / 2015-02-02
* Fixed bug that allowed issue modification notifications to be sent.

## 1.2.0 / 2015-01-30
* Added CHANGELOG.
* Removed `--force` parameter from usage in **init.d** bash script.
* Added support for **new branch** webhook messages.
* Changed **issue** handler to be aware of and report on the new `user` object that contains information
  about the user who performed the action that triggered the webhook.

## 1.1.0 / 2014-01-16
* Added support for **tag** webhook messages.
* Added README.
* Changed configuration to be read from **config.json**.
* Several improvements to the **init.d** bash script.
  * More resilient to crashes; it will determine if a PID file is stale and remove it.
  * Removed `--force` parameter due to the above.
  * Cleaned up echo output.
* Added logging for uncaught exceptions.
* Changed **issue** message handling to ignore modifications.

## 1.0.1 / 2015-01-02
* Removed third-party logging frameworks.
* Added more debug logging output.

## 1.0.0 / 2014-12-23
* Added support for **issue** and **commit** webhook messages.
* Added rudimentary logging.
