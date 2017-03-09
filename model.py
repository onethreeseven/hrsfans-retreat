'''
Data model and associated utility functions.
'''
from __future__ import unicode_literals

import logging
import time
import yaml
from google.appengine.ext import ndb


# This initializes some global data
PARTY_DATA = yaml.load(open('data.yaml'))
AVAILABLE_NIGHTS = {}  # A map from bed IDs to the night IDs when each bed is available

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
    Ensure that IDs are unique strings; standardize types of room costs and set AVAILABLE_NIGHTS.
    '''
    _normalize_ids(PARTY_DATA['days'])

    beds = []
    for group in PARTY_DATA['rooms'].itervalues():
        for room in group:
            beds.extend(room['beds'])
    _normalize_ids(beds)

    for bed in beds:
        bed['costs'] = {str(k): float(v) for k, v in bed['costs'].iteritems()}
        AVAILABLE_NIGHTS[bed['id']] = set(bed['costs'])

normalize_party_data()

# A generic key used only as an ancestor to enable global transactional queries
PARTY_KEY = ndb.Key('Party', '.')


class APIError(Exception):
    '''
    Error class for errors that are "expected" and should be returned to the user.
    '''


def _retrieve_many(cls, key_ids):
    '''
    Helper wrapper around ndb.get_multi(): returns a dictionary from key_ids to objects.
    '''
    keys = [ndb.Key(cls, key_id, parent=PARTY_KEY) for key_id in key_ids]
    return {obj.key.id(): obj for obj in ndb.get_multi(keys) if obj is not None}


class Registration(ndb.Model):
    '''
    A registration.  The key is the registrant's display name.
    '''
    # Identifying data - these are strings, not text, so they are indexed
    email = ndb.StringProperty()
    group = ndb.StringProperty(required=True)

    # Submitted data
    children = ndb.TextProperty(required=True, default='')
    confirmed = ndb.BooleanProperty(required=True, default=False, indexed=False)
    dietary = ndb.TextProperty(required=True, default='')
    emergency = ndb.TextProperty(required=True, default='')
    full_name = ndb.TextProperty(required=True, default='')
    guest = ndb.TextProperty(required=True, default='')
    meal_opt_out = ndb.BooleanProperty(required=True, default=False, indexed=False)
    medical = ndb.TextProperty(required=True, default='')
    phone = ndb.TextProperty(required=True, default='')

    # Financial items; we use None here to indicate that the user has not entered anything yet
    aid = ndb.FloatProperty(required=True, default=0.0, indexed=False)
    consolidated = ndb.FloatProperty(indexed=False)
    subsidy = ndb.FloatProperty(required=True, default=0.0, indexed=False)

    @classmethod
    def group_for_user(cls, user):
        '''
        Find the group that the user belongs to.  If the user is registered, this is the group of
        that registration; otherwise it is the user itself.
        '''
        # This shouldn't be possible, but bad things happen if we accidentally return None
        if user is None:
            raise RuntimeError('Attempted to look up the group for user = None.')
        result = cls.query(cls.email == user, ancestor=PARTY_KEY).get()
        return result.group if result is not None else user

    @classmethod
    @ndb.transactional()
    def create(cls, name, email, group):
        '''
        Create a registration, guarding against data inconsistencies.

        Two rules are enforced:
          * There must not already be a registration with the same name or email.
          * If the email already exists as a group name, the specified group must be the same.
        '''
        logging.info('Creating registration: %r, %r (%r)', name, email, group)
        if cls.get_by_id(name, parent=PARTY_KEY) is not None:
            raise APIError('A registration with this name already exists.')
        if email:
            if cls.query(cls.email == email, ancestor=PARTY_KEY).count(limit=1):
                raise APIError('A registration with this email address already exists.')
            if email != group and cls.query(cls.group == email, ancestor=PARTY_KEY).count(limit=1):
                raise APIError('A user with this email address has already registered a group.')
        cls(parent=PARTY_KEY, id=name, email=email, group=group).put()

    @classmethod
    def get_or_raise(cls, name, group=None):
        '''
        Get a registration or raise APIError.  Optionally pass an expected group.
        '''
        obj = cls.get_by_id(name, parent=PARTY_KEY)
        if obj is None or (group is not None and obj.group != group):
            raise APIError('Failed to find registration.')
        return obj

    @classmethod
    def delete(cls, name, group):
        '''
        Delete a registration.
        '''
        obj = cls.get_or_raise(name, group=group)
        logging.info('Deleting registration: %r', obj.to_dict())
        obj.key.delete()

    @classmethod
    def update(cls, registration, group):
        '''
        Update a registration.
        '''
        if 'email' in registration or 'group' in registration:
            raise APIError("A registration's email and group are immutable.")

        logging.info('Modifying registration: %r (%r)', registration, group)
        obj = cls.get_or_raise(registration.pop('name'), group=group)
        obj.populate(**registration)

        if not (obj.emergency and obj.full_name and obj.phone):
            raise APIError('Missing mandatory field.')
        if obj.confirmed and obj.consolidated is None:
            raise APIError('Missing mandatory field.')
        if (obj.consolidated is not None and obj.consolidated < 0.0):
            raise APIError('Invalid value for field.')

        obj.put()


class Reservation(ndb.Model):
    '''
    A room reservation.  The key is <night ID>|<room ID>.
    '''
    registration = ndb.KeyProperty(kind=Registration, required=True)

    @classmethod
    @ndb.transactional()
    def process_request(cls, reservations, group):
        '''
        Process a reservation request from the client.
        '''
        # Note that, as you would expect, NDB aborts the transaction if we raise an exception.
        logging.info('Beginning reservation transaction: %r (%r)', reservations, group)

        # Retrieve all the existing reservations and related registrations at once.
        existing_reservations = _retrieve_many(cls, reservations)
        new_names = {x for x in reservations.itervalues() if x}
        existing_names = {res.registration.id() for res in existing_reservations.itervalues()}
        registrations = _retrieve_many(Registration, new_names | existing_names)

        # Determine what to do, but do not actually write to the database
        to_put = []
        to_delete = []

        for key, name in reservations.iteritems():
            night, _, room = key.partition('|')

            # Is there an existing reservation that we're not allowed to overwrite?
            existing_res = existing_reservations.get(key)
            if existing_res is not None:
                existing_reg = registrations.get(existing_res.registration.id())
                if existing_reg is not None and existing_reg.group != group:
                    raise APIError('Room already reserved by someone outside the group.')

            # Delete the reservation...
            if not name:
                if existing_res is not None:
                    logging.info('Deleting reservation: %r', existing_res.to_dict())
                    to_delete.append(existing_res.key)

            # ... or create or modify it
            else:
                # Normally NDB encodes everything in UTF-8 when necessary, but this key ID is being
                # retrieved without ever passing it to NDB.  So we have to do it by hand.  :-(
                reg = registrations.get(name.encode('utf-8'))
                if reg is None or reg.group != group:
                    raise APIError('Registration not found in the expected group.')
                logging.info('Reserving %s for %r.', key, name)
                to_put.append(cls(parent=PARTY_KEY, id=key, registration=reg.key))

        # Write to the database all at once
        if to_delete:
            ndb.delete_multi(to_delete)
        if to_put:
            ndb.put_multi(to_put)


class CreditGroup(ndb.Model):
    '''
    A group of credits which are expected to sum to a recorded amount.  The key is an arbitrary ID.
    (This is used to ensure that payments and expenses have been fully credited to registrations.)
    '''
    amount = ndb.FloatProperty(required=True, indexed=False)
    date = ndb.DateTimeProperty(required=True, auto_now_add=True, indexed=False)
    kind = ndb.StringProperty(required=True, indexed=False, choices=('payment', 'expense'))
    details = ndb.JsonProperty(required=True, default={})

    @classmethod
    def get_or_raise(cls, credit_group_id):
        '''
        Get a credit group or raise APIError.
        '''
        obj = cls.get_by_id(credit_group_id, parent=PARTY_KEY)
        if obj is None:
            raise APIError('Failed to find credit group.')
        return obj

    @classmethod
    @ndb.transactional()
    def create_or_replace(cls, credit_group, credits, credit_group_id=None):
        '''
        Create or replace a credit group.  Note that if a previous credit group is passed, it is
        deleted rather than modified in place; however, its date is preserved.
        '''
        # Determine what to do; we have to save the group object once so it has a key
        logging.info('Saving new credit group: %r' % credit_group)
        obj = cls(parent=PARTY_KEY, **credit_group)
        obj.put()

        to_put = [obj]
        for credit in credits:
            credit['credit_group'] = obj.key
            to_put.append(Credit._create_or_update(credit))

        # If requested, get the previous credit group, extract its date, and delete it
        if credit_group_id is not None:
            replaced = cls.get_or_raise(credit_group_id)
            logging.info('Replaced credit group: %r', replaced.to_dict())
            for obj in to_put:
                obj.date = replaced.date  # Both Credits and CreditGroups use "date" for this field
            replaced.key.delete()

        # Write to the database all at once
        ndb.put_multi(to_put)

    @classmethod
    def delete(cls, credit_group_id):
        '''
        Delete the credit group with the given ID.
        '''
        obj = cls.get_or_raise(credit_group_id)
        logging.info('Deleting credit group: %r', obj.to_dict())
        obj.key.delete()


class Credit(ndb.Model):
    '''
    A credit record.  The key is an arbitrary ID.
    '''
    amount = ndb.FloatProperty(required=True, indexed=False)
    category = ndb.TextProperty(required=True, default='')
    credit_group = ndb.KeyProperty(kind=CreditGroup)
    date = ndb.DateTimeProperty(required=True, auto_now_add=True, indexed=False)
    registration = ndb.KeyProperty(kind=Registration, required=True)

    @classmethod
    def get_or_raise(cls, credit_id):
        '''
        Get a credit or raise APIError.
        '''
        obj = cls.get_by_id(credit_id, parent=PARTY_KEY)
        if obj is None:
            raise APIError('Failed to find credit.')
        return obj

    @classmethod
    def _create_or_update(cls, credit, credit_id=None):
        '''
        Shared code for create_or_update() and CreditGroup.create_or_replace() returning an entity.
        '''
        # Get the previous credit if requested
        if credit_id is not None:
            obj = cls.get_or_raise(credit_id)
            logging.info('Modifying credit: %r', obj.to_dict())
        else:
            obj = cls(parent=PARTY_KEY)

        # Get the registration and return
        name = credit.pop('name')
        reg = Registration.get_or_raise(name)
        logging.info('Saving credit: %r, %r', name, credit)
        obj.populate(registration=reg.key, **credit)
        return obj

    @classmethod
    def create_or_update(cls, *args, **kwargs):
        '''
        Create or update a credit.
        '''
        cls._create_or_update(*args, **kwargs).put()

    @classmethod
    def delete(cls, credit_id):
        '''
        Delete the credit with the given ID.
        '''
        obj = cls.get_or_raise(credit_id)
        logging.info('Deleting credit: %r', obj.to_dict())
        obj.key.delete()


@ndb.transactional()
def all_data(group=None):
    '''
    Data for return to the user.  If group is None, all data is returned; otherwise, filters are
    applied appropriate to a non-admin user in the given group.  Additionally, consistency checks
    are applied (and saved to the database if necessary).
    '''
    # Retrieve all the data simultaneously
    classes = (Registration, Reservation, CreditGroup, Credit)
    futures = [c.query(ancestor=PARTY_KEY).fetch_async() for c in classes]
    registrations, reservations, credit_groups, credits = [f.get_result() for f in futures]

    # Build the result, deleting inconsistent objects
    result = {}
    authorized_reg_keys = {reg.key for reg in registrations if group is None or reg.group == group}

    # Registrations
    reg_dicts = {}
    for reg in registrations:
        if reg.key in authorized_reg_keys:
            reg_dict = reg.to_dict()
        else:
            # Non-group-members can only see the name
            reg_dict = {}
        reg_dicts[reg.key.id()] = reg_dict
    result['registrations'] = reg_dicts

    # Reservations
    res_dict = {}
    for res in reservations:
        res_id = res.key.id()
        night, _, room = res_id.partition('|')
        name = res.registration.id()
        if (room not in AVAILABLE_NIGHTS
            or night not in AVAILABLE_NIGHTS[room]
            or name not in reg_dicts):
            logging.info('Deleting inconsistent reservation of %s for %r.', res_id, name)
            res.key.delete()
        else:
            res_dict[res_id] = res.registration.id()
    result['reservations'] = res_dict

    # Credits
    cg_keys = {credit_group.key for credit_group in credit_groups}
    credit_dicts = {}
    for credit in credits:
        cg = credit.credit_group
        if credit.registration.id() not in reg_dicts or (cg is not None and cg not in cg_keys):
            logging.info('Deleting inconsistent credit: %r', credit.to_dict())
            credit.key.delete()
        elif credit.registration in authorized_reg_keys:
            credit_dict = credit.to_dict()
            credit_dict['name'] = credit_dict.pop('registration').id()
            if group is not None:
                # Only admins receive credit groups
                del credit_dict['credit_group']
            elif credit_dict['credit_group'] is not None:
                credit_dict['credit_group'] = credit_dict['credit_group'].id()
            credit_dict['date'] = time.mktime(credit_dict['date'].timetuple())
            credit_dicts[credit.key.id()] = credit_dict
    result['credits'] = credit_dicts

    # Credit groups; only admins see credit groups, but for convenience the field always exists
    cg_dicts = {}
    if group is None:
        cg_dicts = {cg.key.id(): cg.to_dict() for cg in credit_groups}
        for cg in cg_dicts.itervalues():
            cg['date'] = time.mktime(cg['date'].timetuple())
    result['credit_groups'] = cg_dicts

    return result

