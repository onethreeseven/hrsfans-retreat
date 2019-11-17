# TODO


## Miscellaneous improvements

  * General
    - Finish cleaning up the temporary scaffolding that enabled one registration per expense
    - Look at whether more code should be moved into the backend from `postprocessServerData()`
    - Review the result of the 2020 overhaul for further improvements
    - Switch to cents
    - Comprehensive code review
  * Frontend
    - Fix the 500 that happens if you leave the tab open long enough for your token to expire
    - Take advantage of the React Router [5.1 update](https://reacttraining.com/blog/react-router-v5-1/)
    - Clean up the confusing indirection in `RegisterModal`'s `onSuccess()`
    - See if there's a nice way to get `singleContainerSection` out of everything
    - Fix the setState-then-navigate wart in `post()`
    - Display a spinner when waiting for the API; finally expunge the synchronous-XMLHttpRequest warning
  * UX
    - Reword the voluntary contribution language to clarify that it is not per-night and that we might suggest less for short stays
    - Extend `reason` from adjustments to display payment methods and expense descriptions
    - Add HRSFANS advances to the financial report
    - Restore the guest list
    - Overhaul sharing model to allow changing email and reduce unintuitive behavior


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

