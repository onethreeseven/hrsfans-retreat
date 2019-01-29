# TODO


## Miscellaneous work

  * Frontend code
    - Consider extracting common code for forms with a variable number of fields
  * Frontend-API interaction
    - Consider returning objects instead of arrays
    - Fix the setState-then-navigate wart in post()
    - Finally expunge the synchronous-XMLHttpRequest warning
    - Improve error handling, especially if the call crashes
    - Refresh properly if the call returns unauthorized
  * Server
    - Deduplicate `get()` and `post()`
    - Consider storing a generic object instead of a Model object in `State`
    - Look into improving `assert` methods
    - Try splitting payments and expenses
    - Clean up the URL scheme and consider switching to `standardJavaScriptCase`
  * UX
    - Add HRSFANS advances to the financial report
    - Consider restoring the guest list
    - Overhaul sharing model to allow changing email and reduce unintuitive behavior
  * General code review


## Improve deployment

AWS has won the cloud wars, so it might be worth moving there.  At a minimum we should move to a more modern App Engine deployment process and upgrade to Python 3.


## Add a proper build process

We should do things like minify the Javascript and deal properly with dependencies.  This might be rendered trivial by `create-react-app`; we'll see.


## Documentation and collaboration

Some desirable things for the far future:

  * Bring the summer party fork back into the fold
  * Make sure all the tricky parts are commented
  * Finish the README
  * Find a collaborator


## Other feature requests

These have come in; we might need to do them someday.

  * Privacy filter on reserved rooms
  * Proper switch for closing registration

