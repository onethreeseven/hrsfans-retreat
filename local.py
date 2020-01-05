import flask
import json
import logging
import os

from shared import process


logging.basicConfig(level=logging.INFO)

app = flask.Flask(__name__)


@app.route('/call', methods=['POST'])
def call():
    '''
    Main API route.
    '''
    message = flask.request.get_json(force=True)

    # Load any existing local state
    state_path = os.path.join(os.path.dirname(__file__), '.state.json')
    if os.path.exists(state_path):
        with open(state_path) as f:
            state = json.load(f)
    else:
        state = None

    # Process the request; for development we let the client tell us the username
    result, state = process(state, message.pop('_username', None), message)

    # Save state
    with open(state_path, 'w') as f:
        json.dump(state, f)

    return flask.jsonify(result)


@app.route('/')
@app.route('/<path:p>')
def main_html(*args, **kwargs):
    '''
    Serves the master HTML file from all other paths; handled directly by App Engine in deployment.
    '''
    return flask.send_file('static/main.html')


if __name__ == '__main__':
    # Bind to 0.0.0.0 for mobile testing
    app.run(host='0.0.0.0', port=8080, debug=True)
