import jsonschema
import logging
import time
from copy import deepcopy
from secrets import token_hex


# Helper for Interaction.validate(): ensure the objects' IDs are unique and do not contain |
def _check_ids(objects):
    ids = [obj['id'] for obj in objects]
    if len(ids) != len(set(ids)):
        raise RuntimeError('Duplicate ID found.')
    if any('|' in _id for _id in ids):
        raise RuntimeError('"|" found in ID.')


# Given properties, return a schema for an object with exactly those properties
def _exact_object(properties):
    return {
        'type': 'object',
        'properties': properties,
        'required': list(properties),
        'additionalProperties': False
    }

# Given a schema, return a schema for an object with any (nonempty) keys and matching values
def _map_to(schema):
    return {'type': 'object', 'patternProperties': {r'.': schema}, 'additionalProperties': False}

# Given a schema, return a schema for an array of matching values
def _array_of(schema):
    return {'type': 'array', 'items': schema}

_SCHEMA = _exact_object({
    'title': {'type': 'string'},
    'admins': _array_of({'type': 'string'}),
    'nights': _array_of(_exact_object({
        'id': {'type': 'string'},
        'name': {'type': 'string'},
        'date': {'type': 'string'},
        'common': {'type': 'number'},
        'meals': {'type': 'number'},
    })),
    'houses': _array_of(_exact_object({
        'id': {'type': 'string'},
        'name': {'type': 'string'},
        'rooms': _array_of(_exact_object({
            'id': {'type': 'string'},
            'name': {'type': 'string'},
            'beds': _array_of(_exact_object({
                'id': {'type': 'string'},
                'name': {'type': ['string', 'null']},
                'capacity': {'type': 'integer', 'minimum': 1},
                'costs': _map_to({'type': 'number', 'minimum': 0.0})
            }))
        }))
    })),
    'registrations': _map_to(_exact_object({
        'group': {'type': 'string'},
        'fullName': {'type': 'string', 'minLength': 1},
        'name': {'type': 'string', 'minLength': 1},
        'email': {'type': 'string'},
        'phone': {'type': 'string', 'minLength': 1},
        'emergency': {'type': 'string', 'minLength': 1},
        'mealOptOut': {'type': 'boolean'},
        'dietary': {'type': 'string'},
        'medical': {'type': 'string'},
        'children': {'type': 'string'},
        'host': {'type': 'string'},
        'reservations': _array_of({'type': 'string'}),
        'contributions': {'type': 'number', 'minimum': 0.0},
        'assistance': {'type': 'number', 'minimum': 0.0},
        'confirmed': {'type': 'boolean'},
        'adjustments': _array_of(_exact_object({
            'amount': {'type': 'number'},
            'reason': {'type': 'string'}
        }))
    })),
    'payments': _map_to(_exact_object({
        'date': {'type': 'number'},
        'amount': {'type': 'number'},
        'payer': {'type': 'string'},
        'method': {'type': 'string'},
        'allocation': _map_to({'type': 'number'})
    })),
    'expenses': _map_to(_exact_object({
        'date': {'type': 'number'},
        'amount': {'type': 'number'},
        'category': {'type': 'string'},
        'description': {'type': 'string'},
        'regId': {'type': ['string', 'null']}
    }))
})


class APIError(Exception):
    '''
    Error class for errors that are "expected" and should be returned to the user.
    '''


class Interaction(object):
    '''
    A context object that processes data state and request-specific values.
    '''
    def __init__(self, state, username):
        '''
        Constructor; pass the data state and username.
        '''
        self.state = deepcopy(state) or {
            'title': '',
            'admins': [],
            'nights': [],
            'houses': [],
            'registrations': {},
            'payments': {},
            'expenses': {}
        }

        self.username = username
        self.is_admin = self.username in self.state['admins']

        # If the user is registered, their group is the group of that registration; otherwise it is
        # their username
        for reg in self.state['registrations'].values():
            if reg['email'] == self.username:
                self.group = reg['group']
                break
        else:
            self.group = self.username

    def verify_access(self, _key=None, _id=None, **message):
        '''
        Verify access to the object specified in the given message.
        '''
        if _id is not None and _id not in self.state[_key]:
            raise APIError('The requested object was not found.')
        if self.is_admin:
            return
        if _key == 'registrations':
            if _id is None or self.state[_key][_id]['group'] == self.group:
                return
        raise APIError('You do not have access to the requested object.')

    def create(self, _key, **update):
        '''
        Create an object.
        '''
        if _key == 'registrations':
            # Group has to be protected because it affects authorizations
            if ('group' in update or 'adjustments' in update) and not self.is_admin:
                raise APIError("Non-admins cannot modify a registration's group or adjustments.")

            update.setdefault('group', self.group)
            update.setdefault('reservations', [])
            update.setdefault('contributions', 0.0)
            update.setdefault('assistance', 0.0)
            update.setdefault('confirmed', False)
            update.setdefault('adjustments', [])

            # Creating a registration must not change the group for a user who has already created
            # other registrations; note that emails are immutable after creation
            if (update['group'] != update['email']
                and any(reg['group'] == update['email']
                        for reg in self.state['registrations'].values())):
                raise APIError('A user with this email address has already created registrations.')

        elif _key in ('payments', 'expenses'):
            update.setdefault('date', time.time())

        logging.info('Creating object in %r: %r', _key, update)
        self.state[_key][token_hex(16)] = update

    def update(self, _key, _id, **update):
        '''
        Update an object.
        '''
        if _key == 'registrations':
            # Group and email have to be protected because they affect authorizations
            if ('group' in update or 'adjustments' in update) and not self.is_admin:
                raise APIError("Non-admins cannot modify a registration's group or adjustments.")
            if 'email' in update:
                raise APIError("A registration's email is immutable.")

        logging.info('Updating object in %r: %r', _key, self.state[_key][_id])
        logging.info('Update: %r', update)
        self.state[_key][_id].update(update)

    def delete(self, _key, _id):
        '''
        Delete an object.
        '''
        if _key == 'registrations':
            for payment in self.state['payments'].values():
                payment['allocation'].pop(_id, None)
            for expense in self.state['expenses'].values():
                if expense['regId'] == _id:
                    expense['regId'] = None

        logging.info('Deleting object in %r: %r', _key, self.state[_key][_id])
        del self.state[_key][_id]

    def restore(self, old, new):
        '''
        Directly set the data state.
        '''
        if old != self.state:
            raise APIError('The state has changed since you loaded the page.')
        logging.info('Setting new state.')
        self.state = new

    def validate(self):
        '''
        Apply schema and consistency checks; fix the order of otherwise unsorted arrays.
        '''
        jsonschema.validate(self.state, _SCHEMA)

        _check_ids(self.state['nights'])
        night_ids = {night['id'] for night in self.state['nights']}

        res_ids = set()  # The available reservation IDs
        _check_ids(self.state['houses'])
        for house in self.state['houses']:
            _check_ids(house['rooms'])
            for room in house['rooms']:
                _check_ids(room['beds'])
                for bed in room['beds']:
                    for slot_id in range(bed['capacity']):
                        for night_id in bed['costs']:
                            if night_id not in night_ids:
                                raise APIError('Nonexistent night ID in costs.')
                            res_ids.add('%s|%s|%s|%d|%s'
                                        % (house['id'], room['id'], bed['id'], slot_id, night_id))

        names = [reg['name'] for reg in self.state['registrations'].values()]
        if len(names) != len(set(names)):
            raise APIError('A registration with this name already exists.')
        emails = [reg['email'] for reg in self.state['registrations'].values() if reg['email']]
        if len(emails) != len(set(emails)):
            raise APIError('A registration with this email address already exists.')

        for reg in self.state['registrations'].values():
            if not res_ids.issuperset(reg['reservations']):
                raise APIError('One or more rooms is not available.')
            res_ids.difference_update(reg['reservations'])
            reg['reservations'] = sorted(set(reg['reservations']))
            reg['adjustments'].sort(key=lambda a: a['reason'].lower())

        for payment in self.state['payments'].values():
            if any(reg_id not in self.state['registrations'] for reg_id in payment['allocation']):
                raise APIError('Registration for payment allocation not found.')

        for expense in self.state['expenses'].values():
            if expense['regId'] is not None and expense['regId'] not in self.state['registrations']:
                raise APIError('Registration for expense not found.')


_METHODS = {
    'create': Interaction.create,
    'update': Interaction.update,
    'delete': Interaction.delete,
    'restore': Interaction.restore
}

def process(state, username, message):
    '''
    Given a data state, username, and message, process the message and return the appropriate
    response and new data state.
    '''
    if username is None:
        return {'state': {'title': state['title']}}, state

    logging.info('Processing request by %r', username)

    result = {}

    interaction = Interaction(state, username)
    method = message.pop('_method', None)
    if method is not None:
        method = _METHODS[method]
        try:
            interaction.verify_access(**message)
            method(interaction, **message)
            interaction.validate()
        except APIError as e:
            logging.info('Error processing request: "%s"', e)
            result['error'] = str(e)
            interaction = Interaction(state, username)

    result['group'] = interaction.group
    result['registrations'] = deepcopy(interaction.state['registrations'])
    result['state'] = interaction.state
    result['timestamp'] = time.time()
    result['username'] = interaction.username

    # Registrations and associated charges are sent separately to simplify hiding private data
    for reg in result['registrations'].values():
        reg['charges'] = []
    for payment in interaction.state['payments'].values():
        for reg_id, amount in payment['allocation'].items():
            result['registrations'][reg_id]['charges'].append({
                'category': 'Payment or refund',
                'amount': -amount,
                'date': payment['date']
            })
    for expense in interaction.state['expenses'].values():
        if expense['regId'] is not None:
            result['registrations'][expense['regId']]['charges'].append({
                'category': 'Expense: ' + expense['category'],
                'amount': -expense['amount'],
                'date': expense['date']
            })

    if not interaction.is_admin:
        for reg_id, reg in interaction.state['registrations'].items():
            if reg['group'] != interaction.group:
                result['registrations'][reg_id] = {k: reg[k] for k in ('name', 'reservations')}
        result['state'] = {k: interaction.state[k] for k in ('title', 'admins', 'nights', 'houses')}

    return result, interaction.state
