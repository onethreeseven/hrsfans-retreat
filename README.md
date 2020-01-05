# hrsfans-retreat

This is a registration system for the semi-annual retreat of HRSFANS, my science fiction society.  It is unlikely to be of interest to you unless you're collaborating on it with (or taking over for) me, but if you find it useful for some reason, knock yourself out.  It's available under the MIT license.


## Administration

If I've given you administrator access to the app, you can monitor and configure it using the [Google Cloud Platform console](https://console.cloud.google.com/).


### Setting up a new year

Generally, the best way to set up a new year is to use the [direct editing function](#editing-server-state) to clear out the previous year's data and update prices and text.  User-provided data is stored in the `registrations`, `payments`, and `expenses` fields, each of which should be set to `{}` to clear them.

To set up a new installation of the app, you will need to create an initial admin user in order to access this function.  To do this:

  1. Log into the app so it sets up empty state.

  2. Go to the [Google Cloud Platform datastore viewer](https://console.cloud.google.com/datastore/entities).  Open the entity that stores the server state and directly modify the `admins` field to include yourself as an administrator:

     ```
     "admins": ["<your email address>"]
     ```

  3. Reload the app; you should now have admin access.  If you have a backup of a previous year's state, now is a great time to upload it; otherwise you can directly add the appropriate data.


### Recording payments and expenses

(TODO)


### Editing server state

The state editing interface (under the "Other" tab) lets you directly access the complete state of the application.  It uses the mostly self-explanatory [YAML](https://en.wikipedia.org/wiki/YAML) format.

This is used for backup and restore, but it's also the only way to perform certain less-frequent operations, including:

  * Setting the main page title
  * Adding or removing administrators
  * Adding or removing nights and rooms; see the existing data (or, in a pinch, the JSON schema in the code) for a template.  You can reorder entries without trouble as long as you keep their IDs.  If you add a new entry, make sure it has a new ID different from any other in the same list.  If you delete an entry, be sure that there are no associated reservations.  Finally, to indicate that a room is unavailable for a given night, leave out the corresponding room cost.
  * Changing someone's email address
  * Changing who owns a registration or creating a registration owned by someone else

When modifying state in this way, **always save a backup first** and always look over the results.  Note that invalid changes will be rejected by the server with no effect, but the error message you get will be unhelpful; if it's unclear what went wrong, check the logs.


## Development

### Setup

  1. Clone this repository.

  2. Set up a python 3 virtualenv.  On Ubuntu I use `virtualenvwrapper` for this.  To set up a virtualenv named `gcp`:

     ```
     sudo apt install virtualenvwrapper
     mkvirtualenv gcp -p /usr/bin/python3
     ```

     Make sure you have the desired version of Python by running 'python'.  Later you can re-enter the virtualenv using `workon gcp` and exit it using `deactivate`.

  3. Install dependencies into the virtualenv.  From the code checkout directory:

     ```
     pip install -r requirements-local.txt
     ```

  4. Run the local server:

     ```
     python local.py
     ```

You should see the app running at [http://localhost:8080/?user=test@example.com](http://localhost:8080/?user=test@example.com).

Note that to test administrator functions you will need to manually add an admin user; open `.state.json` and see the setup instructions [above](#setting-up-a-new-year).


### Documentation

You may need to consult the documentation for the following services:
  * [App Engine Python 3 environment](https://cloud.google.com/appengine/docs/standard/python3/)
  * [Google Sign-In for Websites](https://developers.google.com/identity/sign-in/web/)
  * [Google Cloud Datastore](https://googleapis.github.io/google-cloud-python/latest/datastore/)

and the following packages:
  * [Flask](http://flask.pocoo.org/)
  * The JSON Schema [Python package](https://python-jsonschema.readthedocs.io/) and [specification](http://json-schema.org/).
  * [React](https://reactjs.org/)
  * [React Router](https://reacttraining.com/react-router/web)
  * [Bulma](https://bulma.io/)
  * [Lodash](https://lodash.com/)
  * [Moment](https://momentjs.com/)
  * [JS-YAML](https://github.com/nodeca/js-yaml)
  * [Font Awesome](https://fontawesome.com/)


### The local environment

By and large the deployed and local apps use the same code; differences are concentrated in `main.py` and `local.py`.  In particular:

  * The deployed app stores state in Google Cloud Datastore.  The local app stores it in a file named `.state.json`.  Note that unlike the deployed server, the local server does not change state transactionally.
  * The deployed app uses Google Sign-In for authentication.  The local app can't even initialize the Google authentication library (since it has the wrong origin domain), so it accepts a `user` URL query parameter instead.  This means that without a username in the query parameter the local app displays nothing, and the login screen and sign out link can only be fully tested on a cloud deployment.
  * Because the local server doesn't use Google APIs, it has a separate pip requirements file.  If you add a non-Google dependency, be sure to update both files.


### Code conventions

  * I use a 100 column line length and 4-space indentation.
  * The Javascript targets ECMA2015, which is by this point reasonably well supported everywhere.

(TODO: some words on Python and Javascript style)


### Architecture

(TODO)


### Maintenance

All library versions used by the app are pinned.  This maximizes the chance that it will continue to run after a year of dormancy, but does necessitate periodic manual updates.  Versions are pinned in the following files:

  * `requirements.txt`
  * `requirements-local.txt`
  * `static/main.html`


### Deploying changes

You probably only want to deploy code changes if I'm out of touch.  To do so:

  1. Download and unpack the [Google Cloud SDK](https://cloud.google.com/sdk/docs/).  The following instructions assume you unpack them into a directory next to your git checkout.

  2. Initialize the SDK:

     ```
     ./google-cloud-sdk/bin/gcloud init
     ```

  3. Deploy the app.  From the git checkout directory:

     ```
     ../google-cloud-sdk/bin/gcloud app deploy
     ```

  4. Use the [App Engine console](https://console.cloud.google.com/appengine/versions) to make sure the correct version is serving all traffic.  It should be safe to delete previous versions.

If something goes awry, try clearing the automatically created files using the [Google Cloud Storage viewer](https://console.cloud.google.com/storage/browser) and deploying again.
