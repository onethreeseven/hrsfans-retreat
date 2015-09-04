# TODO

## v5 - React

This version switches to React from Knockout.  It might cause minor user-visible improvements, but
the focus is getting off Knockout (and hopefully simplifying the HTML and CoffeeScript).


## v6 - Bootstrap

This version switches to Bootstrap from the custom CSS, thus making the interface look nicer.  It
might also spawn UX improvements, but the focus is replacing the custom CSS.


## v7 - User Experience Improvements

  * Streamline the registration experience as much as possible
  * More financial features, e.g. ready-made summary report(s) and accounting for HRSFANS advances
  * Look into saving partial data or autosaving
  * Improve error handling, especially if an API call crashes
  * Refresh properly if an API call returns unauthorized
  * Add an onbeforeunload handler


## v8 - Build Process Overhaul and Technical Cleanup

This has two major phases, with the common theme of improving the technical foundation.

### Build Process Overhaul

  * Make a Makefile
  * Fix up the directory structure
  * Minify the Javascript
  * Look into npm or the like for dependencies

### Technical Cleanup

  * Consider merging model.py and main.py
  * Double-check the Python for warts
  * Go over the CoffeeScript and reorganize as desired
  * Check any custom CSS / HTML for warts
  * Run HTML and CSS validators
  * Investigate unit testing


## v9 and Beyond - Documentation and Collaboration

  * Go over everything and make sure it's commented
  * Finish the README
  * Find a collaborator


## Other Feature Requests (as needed)

  * Privacy filter on reserved rooms
  * Proper switch for closing registration

