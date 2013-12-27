# hrsfans-retreat

This is a registration system for the semi-annual retreat of HRSFANS, my science fiction society. It
is unlikely to be of interest to you unless you're collaborating on it with (or taking over for) me,
but if you find it useful for some reason, knock yourself out. It's available under the MIT license.


## Setting up

I wanted to leverage this project as a learning opportunity, so I used many of the same tools we use
at [my company](http://www.luminoso.com/). I also used Google App Engine, because I didn't want to
deal with hosting, and I'd used it before.

### Things you will need

  * [Python 2.7](http://python.org/).  App Engine doesn't support Python 3 yet, as far as I know.
  * [PyYAML](http://pyyaml.org/).
  * [Coffeescript](http://coffeescript.org/). This is a somewhat Python-esque language that compiles
    to Javascript while filing off a lot of Javascript's warts.
  * The App Engine [Python SDK](https://developers.google.com/appengine/downloads).
 
You may also need the documentation for the following packages, but don't need to download them.

  * [jQuery](http://jquery.com/)
  * [Knockout](http://knockoutjs.com/)
  * [Underscore](http://underscorejs.org/)

### Detailed steps

Clone the Git repository and unzip the SDK. (The following assumes you have the SDK and the repo in
the same directory; adapt as necessary.)

First, you need to compile the Coffeescript to Javascript. I do this by leaving one terminal in the
`static/` directory and running Coffeescript in its continuous compilation mode:

    coffee -w -c .

This will watch your Coffeescript files for changes and automatically refresh the associated
Javascript files. If your Coffeescript file has a syntax error, it will quietly leave the Javascript
file alone, so be sure to check this terminal if your changes don't seem to be doing anything!

Next, run the SDK's development server:

    google_appengine/dev_appserver.py hrsfans-retreat --storage_path data

If all is well, you should be able to browse to a local copy of the registration system at
`localhost:8080`, and see an administrative interface at `localhost:8000`.

### Uploading

If I've given you administrator access to the app, you can upload a new copy by doing

    google_appengine/appcfg.py update hrsfans-retreat

But you probably only want to do this if I'm out of touch or if you're taking over for me.


## Coding conventions

Most of these should be obvious from inspecting the code.  I do try to stick to a line length limit,
but it's 100 columns, not 79; I find that as modern languages lurch ever more functional in nature,
and screens get larger, 79 columns becomes more and more oppressive.

In any event, I only really trust my visual sense in Python; it's quite likely that the HTML, CSS,
and Coffeescript have styling warts that a more seasoned developer in those languages would point
out immediately.


## Architecture

Apologies in advance for the mess.  I'm not a Web developer in my day job...

(TODO: write this maybe)
