---
title: About how the project is tested
sidebar_position: 12
---

# About how the project is tested

Workspace has four kinds of code that fail in different ways: an API that guards data, a web app that people look at, an agent that talks to a language model, and documentation that must match all of them. Each kind is tested in the way that catches its own failures, and a few checks cut across all of them. This page explains the choices, so that a contributor knows what a failing check is protecting and where to add a test. [How to run the tests](../how-to/contribute/run-the-tests.md) gives the commands.

## Tests that use the real thing where it matters

The backend's tests run against a real database and a real Valkey. They start the containers themselves, with random ports, and remove them afterwards. A mock of a database proves that the code calls the mock, while a real one proves that a query works on MySQL, that a migration runs, and that a transaction behaves as the code assumes. The same reasoning covers the migrations. Every migration has to work on MySQL, PostgreSQL and SQLite, because a deployment may choose any of the three, so one test runs the whole chain on a fresh database of each engine and reads every table afterwards. Another keeps the chain in one line: it fails when two revisions share a parent, so that a merge of two branches that both added a migration cannot reach a deployment and stop the API from starting.

The web app's tests follow the usual pyramid. Many fast unit tests cover functions, hooks and components, with the network replaced by a mock server, and a few end-to-end tests drive a real browser against a whole stack. The end-to-end tests run over HTTPS, as a deployment serves the app, because the session cookie is secure and a test over plain HTTP would not be testing the cookie that users have. The plugin specs run in Chromium, Firefox and WebKit, because a plugin's frame, its policy and its workers are where the engines differ, and so does the test that a dashboard is saved when the page goes away, because WebKit cancels a request that is in flight at that moment.

The testing guide of the web app draws the line between them. End-to-end tests are for the critical journeys, such as signing in and creating a dashboard, and for features with complex browser interaction. The behavior of a component, the handling of an API response and the edge cases are tested lower, because a failure is cheaper to find and easier to read there.

## Tests that cannot be exact

The agent's behavior has a part that is code and a part that is a model, and they are tested differently. The code, which decides what the model sees, which tools it may call and how results are read, has ordinary tests that run in seconds. The model's behavior, such as whether it picks the right widget or the right tool, cannot be asserted with an exact answer, so it has evaluations: scripted questions that run against a real model several times and score what it did. Evaluations cost money and vary from run to run, so they are not part of the checks that every pull request passes. They are run by hand when something changes what the model is shown.

A pattern that reads text from outside, such as a regular expression over a web page, is tested with hostile text. Such a pattern can take a time that grows with the square of its input, and the only test that shows it is one that feeds it the worst input.

## Tests that keep other things honest

A number of checks exist to stop two things from drifting apart, and most of them concern the documentation. The reference pages are generated from the code: the settings and their descriptions, the routes of the API, the tables of the database, the metrics, the messages of the plugin protocol and the limits of the web app. A test fails when a setting, a manifest field, a widget property or a command has no description, so that a new one cannot ship without being documented. A test compares the list of the API's request metrics with what its instrumentation registers, and another fails when the agent reads an environment variable that its description file does not mention. The documentation site's generator also checks that the pages that people write by hand mention what the code defines, and its build fails on a broken link. A page that went stale therefore turns into a failed build, and nobody has to remember to look.

The same idea covers the schemas that other systems depend on. The schema of `widgets.json` is generated from the web app's contract, and a test fails when the committed copy differs from the generated one. A fixture records the tools of the Workspace MCP server, so that a change to the tools shows up as a change to a file in the pull request.

## Bugs get a test first

A bug fix starts with a test that reproduces the bug and fails for the right reason. The fix makes it pass, and the test stays as a guard. A fix without such a test would only say that the bug is gone today, whereas the test says it stays gone. New features follow the same order where they can: the test states the behavior, it fails, and the code makes it pass. This is slower for the first change and faster for every later one, because a contributor who changes behavior near a test learns at once what depended on it.
