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
