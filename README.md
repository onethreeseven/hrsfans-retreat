# hrsfans-retreat

This is a registration system for the semi-annual retreat of HRSFANS, my science fiction society. It is unlikely to be of interest to you unless you're collaborating on it with (or taking over for) me, but if you find it useful for some reason, knock yourself out. It's available under the MIT license.


## Setting up

### Things you will need

  * [Python 2.7](http://python.org/).  The App Engine deployment mode the system currently uses doesn't support Python 3.
  * The App Engine [Python SDK](https://cloud.google.com/appengine/downloads).
 
You may also need the documentation for the following packages, but don't need to download them.

  * [React](https://reactjs.org/)
  * [React Router](https://reacttraining.com/react-router/web)
  * [Bulma](https://bulma.io/)
  * [Lodash](https://lodash.com/)
  * [Moment](https://momentjs.com/)
  * [Font Awesome](https://fontawesome.com/)

### Developing

Clone the Git repository and unzip the SDK. (The following assumes you have the SDK and the repo in the same directory; adapt as necessary.)

Run the SDK's development server:

    python google_appengine/dev_appserver.py hrsfans-retreat --storage_path data

If all is well, you should be able to browse to a local copy of the registration system at `localhost:8080`, and see an administrative interface at `localhost:8000`.

### Uploading

If I've given you administrator access to the app, you can upload a new copy by doing

    python google_appengine/appcfg.py update hrsfans-retreat

But you probably only want to do this if I'm out of touch or if you're taking over for me.


## Code conventions

  * I use a 100 column line length and 4-space indentation.
  * The Javascript targets ECMA2015, which is by this point reasonably well supported everywhere.

I might add other conventions here when the code has stabilized again after pending changes.


## Architecture

(TODO: write this maybe)
