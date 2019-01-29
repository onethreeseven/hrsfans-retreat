from __future__ import unicode_literals

import json
import logging
import time
import webapp2
import yaml
from copy import deepcopy
from os import getenv
from uuid import uuid4
from google.appengine.api import users
from google.appengine.ext import ndb


# This initializes some global data
PARTY_DATA = yaml.load(open('data.yaml'))
RES_IDS = set()  # The permissible reservation IDs, based on room availability.

# Helper for normalize_party_data(): ensure the objects' IDs are unique and do not contain |
def _normalize_ids(l):
    ids = []
    for d in l:
        d['id'] = str(d['id'])
        ids.append(d['id'])
    if len(ids) != len(set(ids)):
        raise RuntimeError('Duplicate ID found.')
    if any('|' in _id for _id in ids):
        raise RuntimeError('"|" found in ID.')

def normalize_party_data():
    '''
    Ensure that IDs are unique strings; standardize types of room costs and set RES_IDS.
    '''
    _normalize_ids(PARTY_DATA['nights'])

    _normalize_ids(PARTY_DATA['houses'])
    for house in PARTY_DATA['houses']:
        _normalize_ids(house['rooms'])
        for room in house['rooms']:
            _normalize_ids(room['beds'])
            for bed in room['beds']:
                bed['costs'] = {str(k): float(v) for k, v in bed['costs'].iteritems()}
                for slot_id in range(bed['capacity']):
                    for night_id in bed['costs']:
                        RES_IDS.add('%s|%s|%s|%d|%s'
                                    % (house['id'], room['id'], bed['id'], slot_id, night_id))

normalize_party_data()


# Helpers for validating JSON fields
CREDIT_GROUP_DETAILS_FIELDS = {'payment': {'from', 'via'}, 'expense': {'description'}}

def assert_in(x, options):
    if x not in options:
        raise APIError('Expected one of %s.' % json.dumps(sorted(options)))

def assert_number(x, nullable=False, nonnegative=False):
    if x is None and nullable:
        return
    if not isinstance(x, (int, float)):
        raise APIError('Expected a number.')
    if nonnegative and x < 0.0:
        raise APIError('Expected a nonnegative number.')

def assert_string(x, nonempty=False):
    if not isinstance(x, unicode):
        raise APIError('Expected a string.')
    if nonempty and not x:
        raise APIError('Expected a nonempty string.')

def assert_boolean(x, nullable=False):
    if x is None and nullable:
        return
    if not isinstance(x, bool):
        raise APIError('Expected a boolean.')

def assert_array(x):
    if not isinstance(x, list):
        raise APIError('Expected an array.')

def assert_object(x, fields):
    if not isinstance(x, dict):
        raise APIError('Expected an object.')
    if set(x) != fields:
        raise APIError('Unexpected object fields.')


class APIError(Exception):
    '''
    Error class for errors that are "expected" and should be returned to the user.
    '''


class Party(ndb.Model):
    '''
    Stores global state.
    '''
    registrations = ndb.JsonProperty(required=True, default={})
    reservations = ndb.JsonProperty(required=True, default={})
    credit_groups = ndb.JsonProperty(required=True, default={})


class State(object):
    '''
    A context object that loads the server state and holds request-specific values.
    '''
    def __init__(self):
        '''
        Constructor; constructing a State object loads data from the database.
        '''
        # For now we support only one party with this fixed key
        self.party = Party.get_or_insert('.')
        self._party_snapshot = deepcopy(self.party.to_dict())

        self.is_admin = users.is_current_user_admin()
        self.reservations_enabled = (time.time() > PARTY_DATA['enable_reservations_after']
                                     or self.is_admin)
        self.username = unicode(users.get_current_user().email())

        # If the user is registered, their group is the group of that registration; otherwise it is
        # their username
        for reg in self.party.registrations.itervalues():
            if reg['email'] == self.username:
                self.group = reg['group']
                break
        else:
            self.group = self.username

    def _assert_reservations_enabled(self):
        '''
        Raise APIError if reservations are not enabled.
        '''
        if not self.reservations_enabled:
            raise APIError('Reservations not yet enabled.')

    def _get_registration(self, name):
        '''
        Get a registration (which the user is authorized to retrieve) or raise APIError.
        '''
        obj = self.party.registrations.get(name)
        if obj is None or (obj['group'] != self.group and not self.is_admin):
            raise APIError('Failed to find registration.')
        return obj

    def _get_credit_group(self, id):
        '''
        Get a credit group or raise APIError.
        '''
        if id not in self.party.credit_groups:
            raise APIError('Failed to find credit group.')
        return self.party.credit_groups[id]

    def record_registration(self, name=None, new_name=None, **update):
        '''
        Create or update a registration.

        The group and email fields interact with the security model, so special rules apply:
          * Non-admins can only set a registration's group to their own.  Since non-admins can only
            modify registrations within their group, the group is actually immutable by non-admins.
          * Only one registration can be created with any (nonempty) email address.  Furthermore,
            creating the registration must not change the group for a user who has already created
            other registrations.  Email addresses are immutable after creation.
        '''
        if new_name is None:
            new_name = name
        assert_string(new_name, nonempty=True)
        if new_name != name and new_name in self.party.registrations:
            raise APIError('A registration with this short name already exists.')

        if update.get('confirmed'):
            self._assert_reservations_enabled()
        if 'adjustments' in update and not self.is_admin:
            raise APIError('Non-admins cannot modify adjustments.')

        if name is None:
            update.setdefault('group', self.group)
            if update['email']:
                if any(reg['email'] == update['email']
                       for reg in self.party.registrations.itervalues()):
                    raise APIError('A registration with this email address already exists.')
                if (update['group'] != update['email']
                    and any(reg['group'] == update['email']
                            for reg in self.party.registrations.itervalues())):
                    raise APIError('A user with this email address has already registered a group.')

            update.setdefault('contributions', None)
            update.setdefault('assistance', 0.0)
            update.setdefault('travel', 0.0)
            update.setdefault('confirmed', False)
            update.setdefault('adjustments', [])
            logging.info('Creating registration for %r: %r', new_name, update)
        else:
            assert_string(name, nonempty=True)
            if 'email' in update:
                raise APIError("A registration's email is immutable.")

            existing = self._get_registration(name)
            logging.info('Modifying registration for %r: %r', name, existing)
            logging.info('Modification: %r', update)
            update = dict(existing, **update)

        assert_object(update, {
            'group', 'full_name', 'email', 'phone', 'emergency', 'meal_opt_out', 'dietary',
            'medical', 'children', 'guest', 'contributions', 'assistance', 'travel', 'confirmed',
            'adjustments'
        })
        assert_string(update['group'])
        if update['group'] != self.group and not self.is_admin:
            raise APIError("Non-admins cannot override a registration's group.")
        assert_string(update['full_name'], nonempty=True)
        assert_string(update['email'])
        assert_string(update['phone'], nonempty=True)
        assert_string(update['emergency'], nonempty=True)
        assert_boolean(update['meal_opt_out'])
        assert_string(update['dietary'])
        assert_string(update['medical'])
        assert_string(update['children'])
        assert_string(update['guest'])
        assert_number(update['contributions'], nullable=(not update['confirmed']), nonnegative=True)
        assert_number(update['assistance'], nonnegative=True)
        assert_number(update['travel'], nonnegative=True)
        assert_boolean(update['confirmed'])
        assert_array(update['adjustments'])
        for adjustment in update['adjustments']:
            assert_object(adjustment, {'amount', 'reason'})
            assert_number(adjustment['amount'])
            assert_string(adjustment['reason'])

        if name is not None and new_name != name:
            logging.info('Renaming %r to %r', name, new_name)
            del self.party.registrations[name]
            for k, n in self.party.reservations.items():
                if n == name:
                    self.party.reservations[k] = new_name
            for cg in self.party.credit_groups.itervalues():
                for c in cg['credits']:
                    if c['name'] == name:
                        c['name'] = new_name

        self.party.registrations[new_name] = update

    def delete_registration(self, name):
        '''
        Delete a registration.
        '''
        obj = self._get_registration(name)
        logging.info('Deleting registration for %r: %r', name, obj)
        del self.party.registrations[name]

    def update_reservations(self, name, keys):
        '''
        Update the reservations for the given name.
        '''
        self._assert_reservations_enabled()

        # Verify access to the registration
        self._get_registration(name)

        # Compute the keys to add and remove
        keys = set(keys)
        current = {k for k, n in self.party.reservations.iteritems() if n == name}
        to_add = keys - current
        to_delete = current - keys

        # Check for collisions
        if to_add.intersection(self.party.reservations):
            raise APIError('One or more rooms is already reserved.')

        # Make the modifications
        logging.info('Modifying reservations for %r: %r', name, sorted(current))
        if to_delete:
            logging.info('Deleting reservations: %r', sorted(to_delete))
            for key in to_delete:
                del self.party.reservations[key]
        if to_add:
            logging.info('Adding reservations: %r', sorted(to_add))
            for key in to_add:
                self.party.reservations[key] = name

    def record_credit_group(self, id=None, **update):
        '''
        Create or update a credit group.
        '''
        if not self.is_admin:
            raise APIError('Non-admins cannot modify credit groups.')

        if id is None:
            id = unicode(uuid4())
            update.setdefault('date', time.time())
            logging.info('Creating credit group: %r', update)
        else:
            existing = self._get_credit_group(id)
            logging.info('Modifying credit group: %r', existing)
            logging.info('Modification: %r', update)
            update = dict(existing, **update)

        assert_object(update, {'date', 'kind', 'amount', 'details', 'credits'})
        assert_number(update['date'])
        assert_in(update['kind'], CREDIT_GROUP_DETAILS_FIELDS)
        assert_number(update['amount'])
        assert_object(update['details'], CREDIT_GROUP_DETAILS_FIELDS[update['kind']])
        for v in update['details'].itervalues():
            assert_string(v)
        assert_array(update['credits'])
        for credit in update['credits']:
            assert_object(credit, {'amount', 'name', 'category'})
            assert_number(credit['amount'])
            self._get_registration(credit['name'])
            assert_string(credit['category'])

        self.party.credit_groups[id] = update

    def delete_credit_group(self, id):
        '''
        Delete a credit group.
        '''
        if not self.is_admin:
            raise APIError('Non-admins cannot modify credit groups.')

        obj = self._get_credit_group(id)
        logging.info('Deleting credit group: %r', obj)
        del self.party.credit_groups[id]

    def commit(self):
        '''
        Apply consistency checks, write any pending changes, and return the server data that should
        be sent to the user (hiding private data from non-admins).
        '''
        # Apply consistency checks and collect credits by name
        for key, name in self.party.reservations.items():
            if key not in RES_IDS or name not in self.party.registrations:
                logging.info('Deleting inconsistent reservation of %s for %r', key, name)
                del self.party.reservations[key]

        credits_by_name = {name: [] for name in self.party.registrations}
        for cg in self.party.credit_groups.itervalues():
            consistent_credits = [c for c in cg['credits'] if c['name'] in self.party.registrations]
            if len(consistent_credits) != len(cg['credits']):
                logging.info('Deleting inconsistent credits in credit group: %r', cg)
                logging.info('New credits: %r', consistent_credits)
                cg['credits'] = consistent_credits
            for credit in consistent_credits:
                credit = dict(credit, date=cg['date'])
                credits_by_name[credit.pop('name')].append(credit)

        # Assemble the result and hide private data
        result = {
            'registrations': [dict(reg, name=name, credits=credits_by_name[name])
                              for name, reg in self.party.registrations.iteritems()],
            'reservations': self.party.reservations,
            'credit_groups': [dict(cg, id=id) for id, cg in self.party.credit_groups.iteritems()],
            'group': self.group
        }
        if not self.is_admin:
            result['registrations'] = [reg if reg['group'] == self.group else {'name': reg['name']}
                                       for reg in result['registrations']]
            del result['credit_groups']

        # Commit changes
        if self.party.to_dict() != self._party_snapshot:
            logging.info('Committing changes.')
            self.party.put()
            self._party_snapshot = deepcopy(self.party.to_dict())

        return result


class Init(webapp2.RequestHandler):
    '''
    Returns the data needed to initialize the page.
    '''
    @ndb.transactional()
    def get(self):
        state = State()

        result = {
            'party_data': PARTY_DATA,
            'server_data': state.commit(),
            'user_data': {
                'is_admin': state.is_admin,
                'reservations_enabled': state.reservations_enabled,
                'username': state.username
            }
        }
        if not getenv('SERVER_SOFTWARE', '').startswith('Google App Engine/'):
            result['user_data']['logout_url'] = users.create_logout_url('/')

        self.response.headers[b'Content-Type'] = b'application/json'
        self.response.write(json.dumps(result))


def post_handler(method):
    '''
    Make a POST method handler; pass a State method accepting a message as kwargs.
    '''
    class Handler(webapp2.RequestHandler):
        @ndb.transactional()
        def post(self):
            state = State()
            message = json.loads(self.request.body)

            result = {}
            try:
                method(state, **message)
            except APIError as e:
                logging.info('Error processing request: "%s"', e)
                result['error'] = str(e)
            result['server_data'] = state.commit()

            self.response.headers[b'Content-Type'] = b'application/json'
            self.response.write(json.dumps(result))

    return Handler


application = webapp2.WSGIApplication([
    ('/call/init', Init),
    ('/call/record_registration', post_handler(State.record_registration)),
    ('/call/delete_registration', post_handler(State.delete_registration)),
    ('/call/update_reservations', post_handler(State.update_reservations)),
    ('/call/record_credit_group', post_handler(State.record_credit_group)),
    ('/call/delete_credit_group', post_handler(State.delete_credit_group))
])

