# Specific Items

## v4 Overhaul

### Models
  * Revised group-based registration
      * Better handling of "on behalf of" registrations
      * Better handling of guests without email addresses
      * Delete registrations properly
      * Improved authorizations interface
      * No-email-sending design
  * Improved financial data model
      * Remove ad-hoc tables
      * Uniform categorization between inflows and outflows
      * Present the financials table in a way that directly correlates with final reporting
  * Generally improved data model
      * No "Conspiracies"
      * Unified data return for admin and regular users
      * Streamline and simplify as much as possible
  * Goal: stable "final" design

### UI
  * Unified admin and main interface
  * Streamlined step-based user experience
  * More comprehensible handling of financials, including accounting for HRSFANS advances
  * Switch to Bootstrap

### Engineering
  * Minor refactors to Coffeescript
  * Disallow non-Google logins


## v5 and Beyond

### Features
  * Privacy filter on reserved rooms - v6 or as needed
  * Proper switch for closing registration - v6 or as needed

### UI
  * Look into saving partial data or autosaving - v5
  * Improve error reporting in the UI - v6
  * Refresh properly if an API call returns unauthorized - v6
  * Implement an onbeforeunload handler - v6
  * Make it look nicer - v7?

### Documentation
  * Finish the README - v6
  * Comment the API, Coffeescript and CSS - v6

### Engineering
  * Consider switching to React - v5
  * Clean up HTML and CSS - v5
  * Run HTML and CSS validators - v5
  * "Final" refactors to Coffeescript - v6
  * Introduce HTML templating system and make a Makefile - v6
  * Fix up the directory structure - v6
  * Minify the Javascript - v6

### Meta
  * Find and bring up to speed a collaborator - v7?


# Overhaul Plan

The broad goal of the overhaul is to get the backend into a **simplified**, **more usable** state that approximates the final shape I would want it to take before handing it off to someone else.  (We're also going to start getting the frontend into shape, by switching to Bootstrap.)  The system should be stripped down to its core functionality, namely:
  1. Collect and display people's registration information
  1. Allow people to reserve rooms
  1. Collect people's aid requests / contributions and display the amount due
  1. Record and display payments, expenses, and adjustments; compute a financial summary

We should seek the simplest implementation of this possible, with an eye towards letting anyone at all run registration, and any reasonable technical person (e.g. an undergraduate) maintain the system.

## Groups

Group registrations need to support two different use cases:
  1. A single person is registering a family, significant other, or guest.
  1. Multiple people want to reserve rooms together.

By recognizing the separate use cases, we can support group registrations in a simplified way (avoiding the whole authorization and email-sending mess):
  * Each group consists of a person and possibly some number of *guests*.
  * The guests aren't users, and shouldn't expect to log in and see themselves.  The group pays together.
  * Separately, it is possible to allow other users to reserve rooms for you, simply by entering the email address of the user into a field.

Note that because we are allowing Google logins only, every user comes with a pre-verified email address!

There is a separate need for admins to view and edit registrations other than their own, but that should be as simple as giving them a dropdown where they can select a user to view.

## Financials

With the new group design it's reasonable to credit each payment to just one group, meaning that payments, expenses, and adjustments have the same structure.  They should not share a table, however, because they reflect totally different things: one is about money in and out, and the other is about changing the amount due.

## Interface

Registration should be a simple four-step process: enter your (group's) personal information; reserve your rooms; confirm; pay.  Conversely, the money parts of the interface should be designed to maximize interaction efficiency.

