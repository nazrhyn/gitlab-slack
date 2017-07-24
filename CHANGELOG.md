## 2.0.1 / 2017-07-24
* Fixed issue with filename casing

## 2.0.0 / 2017-07-21
I wrote this service only a few months after I had started writing Node.js for the first time. The more time went by, the more what I had written distressed me and became harder to maintain. I finally got some time to rewrite the whole thing, fixing some bugs and adding features in the process. While I'm not willing to send this release to the Ivory Tower, I'm still significantly happier with it.

**Enjoy.**

### Project Changes
* Complete re-write of the whole service from the ground up using ES6 syntax, coroutines, and other delightful, modern things
* Now targeting Node.js 6.x LTS and NPM 5.x
  * Added `package-lock.json`
* Designed to work with the **v4** GitLab API and other features from GitLab **9.x**
* Added `.editorconfig` to enforce line endings and help with Markdown ([more info](http://editorconfig.org/))
* Switched from **JSHint** to **ESLint** (4.2.0)
* Switched from **underscore** to **lodash** (4.17.x)
* Switched to **debug** for logging and dropped my _special_ logger (Fixes #15)
  * In supported terminals, logging output is colored for improved readability
* Updated the `package.json` with some more information and marked the package as private
* Updated the `README.md` with new features, up-to-date screenshots and more details
  * Added a **Limitations** section that hopefully will cover the constraints of the project

### Service Changes
* Added handling for `SIGINT` and `SIGTERM` for more graceful exits
* Where appropriate, **Bluebird** coroutines using generator functions are used to simplify asynchronous code
* All code is strict-mode ES6, taking advantage of fun language features where appropriate
* Significant modularization applied to split components into small working parts
* Issue and label caching system slimmed and improved
  * Only watched labels are cached rather than all labels of qualifying issues
* All handler code is appropriately connected through uninterrupted promise chains
  * Fixes some phantom, unhandled promise return issues and allows **Bluebird** warnings to remain on :tada:
* Tried using the `WeakMap` "privates" pattern with ES6 classes; I'm still on the fence on this one
* Added an attempt at intellingent resolution of GitLab project ID from available information
  * When `project_id` is present in webhook objects is inconsistent and this service needs it to look up the project configuration
* Significantly cleaned up and improved HTTP server code

### Notification Changes
* Significant simplification and reduction in GitLab API calls due to GitLab increasing what is available in webhook messages
* Added support for merge request notifications
* Added support for wiki page notifications
* When a new-branch message is processed, if it includes any commits, those are also notified (Fixes #14)
* When a tag includes a message, it is notified as well
* Re-ordered first line of issue notification to match data-point order of other notification types
* Issue links no longer duplicate issue mentions found in the first line of commit messages
* Improved Markdown-to-Slack-formatting converter
  * Headings that are already bolded will be left as such
* Simplification and tightening up of issue handling and label tracking

------

## 1.7.2 / 2016-10-03
* Fixed an issue where label update notifications are sent after an issue is closed (Fixes #20)

## 1.7.1 / 2016-08-08
* Updated dependencies
  * **bluebird** -> 3.4.1
  * **request-promise** -> 4.1.1 (added **request** as peer dependency)
* Updated bullet regex to make sure it doesn't match initial bold text (Fixes #18)
* Added unique filter for detected issue mentions (Fixes #17)
* Changed cacheIssueLabels to use map->each with concurrency (Fixes #10)
* Refactored initial loading promise chain error handling to actually work properly

## 1.7.0 / 2015-12-11
* Fixed some issues with missing configuration not falling back to defaults caused by label tracking changes.
* Fixed image link formatting translation (Fixes #12).
* Reversed the commit list in commit notifications for a more useful display order (Fixes #6).
* Added milestone to issue notification header (Fixes #11).
* Updated README and screenshots for changes and to remove init-flavor-specific instructions.
* Updated **bluebird** to 3.0.x.
* Changed promisified **request** out for **request-promise**.

## 1.6.0 / 2015-10-19
* Added feature information to the README file. See this file for more information on this version's changes.
* Added issue label tracking (Fixes #7).
* Significantly changed the structure of the **config.json** file.
* Fixed issue with user resolution of similarly-named users (Fixes #5).
* Removed remaining hard-coded URLs (Fixes #8).

## 1.5.0 / 2015-08-07
* Added limited translation from Markdown to Slack-style formatting. Supported formatting:
  * **Bold** -- `**|__` -> `*`
  * **Italic** -- `*|_` -> `_`
  * **Links/Images** -- `![T](U)|[T](U)` -> `<U|T>`    
    _Since there's no way to send more than one image with an attachment, images are simply converted into links._
  * **Bullets** -- `*|  *` -> `�|\t�`    
    _Initial asterisks indented by one or more spaces are changed to be indented by a single tab._
  * **Headings** -- `#... T` -> `*T*`    
    _Headings are converted to bolded text._

## 1.4.0 / 2015-08-07
* Added .jshintrc and cleaned up JSHint issues.
* Updated **request** module.
* Migrated from **q** to **bluebird**.
  * Broad cleanup and simplification of promises.
* Minor changes in preparation for partitioning code.
* Rephrased commit message to not imply ownership (Fixes #2).
* Added issue mention summary for commit messages (Fixes #1).
  * The entire commit message is searched for issue mentions. If found, they are appended to the first line in the notification.
* Reworked request response/error processing (Fixes #4).

## 1.3.1 / 2015-03-31
* Cleanup for initial push to GitHub.
* Added MIT license.
* Added TODO.
* Changed configuration variables from URI to URL.
* Added `gitlab_api_base_url` config setting.

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
