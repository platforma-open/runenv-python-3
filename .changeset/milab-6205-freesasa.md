---
'@platforma-open/milaboratories.runenv-python-3.12.10': minor
---

Add freesasa 2.2.1 to the base Python 3.12.10 run environment. freesasa publishes no cp312 or Linux wheels, so it is declared as a dependency plus a buildWheel entry that compiles the C extension on the native runner for all five platforms. The sdist ships pre-generated C, so the build needs only setuptools and wheel.
