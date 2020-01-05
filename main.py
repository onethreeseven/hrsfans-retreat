import flask
import google.auth.transport.requests
import json
import logging
import requests
from cachecontrol import CacheControl
from google.cloud import datastore
from google.oauth2.id_token import verify_oauth2_token

from shared import process


CLIENT_ID = '308261241949-7948flf1cudha1bjaf5fu00sklsebbkl.apps.googleusercontent.com'
SESSION = CacheControl(requests.session())

logging.basicConfig(level=logging.INFO)

app = flask.Flask(__name__)


@app.route('/call', methods=['POST'])
def call():
    '''
    Main API route.
    '''
    message = flask.request.get_json(force=True)

    # Extract and verify the ID token
    username = None
    if '_token' in message:
        request = google.auth.transport.requests.Request(session=SESSION)
        idinfo = verify_oauth2_token(message.pop('_token'), request, CLIENT_ID)
        if idinfo['iss'] not in ('accounts.google.com', 'https://accounts.google.com'):
            raise RuntimeError('Bad issuer in ID token')
        username = idinfo['email']

    # Process the message inside an appropriate transaction
    client = datastore.Client()
    with client.transaction():
        key = client.key('Party', '.')
        entity = client.get(key) or datastore.Entity(key=key, exclude_from_indexes=('state',))
        if 'state' in entity:
            state = json.loads(entity['state'])
        else:
            state = {}

        result, new_state = process(state, username, message)

        if new_state != state:
            entity['state'] = json.dumps(new_state, ensure_ascii=False)
            client.put(entity)

    return flask.jsonify(result)
