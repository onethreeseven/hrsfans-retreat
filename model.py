'''
Data model and associated utility functions.
'''
import logging
import random
import string
import yaml

from google.appengine.api import mail, users
from google.appengine.ext import ndb


# This initializes some global data
PARTY_DATA = yaml.load(open('data.yaml'))
NIGHTS = {day['id'] for day in PARTY_DATA['days'][:-1]}
# This is a map from bed IDs to the night IDs when each bed is available
AVAILABLE_NIGHTS = {}

# Helper for normalize_party_data()
def _normalize_ids(l):
    seen_ids = set()
    for d in l:
        d['id'] = str(d['id'])
        if '|' in d['id']:
            raise RuntimeError('"|" found in ID.')
        if d['id'] in seen_ids:
            raise RuntimeError('Duplicate ID %r found.' % d['id'])
        seen_ids.add(d['id'])

def normalize_party_data():
    '''
    Ensure that IDs are unique strings.
    '''
    _normalize_ids(PARTY_DATA['days'])
    _normalize_ids(PARTY_DATA['meals'])

    beds = []
    for group in PARTY_DATA['rooms'].itervalues():
        for room in group:
            for bed in room['beds']:
                beds.append(bed)
    _normalize_ids(beds)

    for bed in beds:
        bed['costs'] = {str(k): float(v) for k, v in bed['costs'].iteritems()}
        AVAILABLE_NIGHTS[bed['id']] = set(bed['costs'])

normalize_party_data()


class Party(ndb.Model):
    '''
    A party.

    Party <party name>
    '''
    # Doesn't actually store anything right now

PARTY_KEY = ndb.Key(Party, '.')


class User(ndb.Model):
    '''
    A user.

    Party <party name>
        User <federated identity>
    '''
    # Doesn't actually store anything right now


class Authorization(ndb.Model):
    '''
    Authorization for a user to see a registration.

    Party <party name>
        User <federated identity>
            Authorization <email>
    '''
    activated = ndb.BooleanProperty(required=True, default=False, indexed=False)
    email_token = ndb.StringProperty()
    user_nickname = ndb.StringProperty(required=True, indexed=False)

    @classmethod
    def add(cls, email, user, nickname, activate_immediately=False, respect_tombstone=False):
        '''
        Add the specified authorization and send email if necessary.
        '''
        if respect_tombstone:
            if ndb.Key(User, user, AuthTombstone, email, parent=PARTY_KEY).get() is not None:
                return

        logging.info('Adding authorization: %r, %r', email, user)
        authorization = cls.get_or_insert(
            email,
            parent=ndb.Key(User, user, parent=PARTY_KEY),
            user_nickname=nickname,
            activated=activate_immediately
        )

        # If told to activate immediately, this overwrites the previous state
        if activate_immediately and not authorization.activated:
            authorization.activated = True
            authorization.put()

        # This check saves a transaction
        if not authorization.activated:
            authorization.send_email_if_necessary()

    @classmethod
    def for_user(cls, user):
        '''
        Get the authorizations for this user.
        '''
        return cls.query(ancestor=ndb.Key(User, user, parent=PARTY_KEY)).fetch()

    @classmethod
    def is_authorized(cls, email, user):
        '''
        Report whether the given authorization exists and is activated.
        '''
        obj = cls.get_by_id(email, parent=ndb.Key(User, user, parent=PARTY_KEY))
        return obj is not None and obj.activated

    @classmethod
    def process_token(cls, token):
        '''
        Activate the authorization with the given token.  Reports the number activated.
        '''
        processed = 0
        for obj in cls.query(cls.email_token == token, ancestor=PARTY_KEY):
            logging.info('Processing email token for authorization: %r, %r',
                         obj.key.id(), obj.key.parent().id())
            obj.activated = True
            obj.email_token = None
            obj.put()
            processed += 1
        return processed

    @classmethod
    def remove(cls, email, user):
        '''
        Remove the specified authorization if it exists.
        '''
        logging.info('Removing authorization: %r, %r', email, user)
        ndb.Key(User, user, cls, email, parent=PARTY_KEY).delete()
        AuthTombstone.get_or_insert(email, parent=ndb.Key(User, user, parent=PARTY_KEY))

    @classmethod
    def select_emails(cls, authorizations):
        '''
        Utility method to pull the authorized emails out of a list of Authorization objects.
        '''
        return {obj.key.id() for obj in authorizations if obj.activated}

    def key_and_dict(self):
        '''
        Return a string from the object's key and a dict representation of the object.
        '''
        result = self.to_dict()
        # Users can only see whether there is an email token, not (obviously) what it is
        result['email_token'] = bool(result['email_token'])
        return self.key.id(), result

    EMAIL_BODY = '''Hi there!

You're getting this email because someone wants to register you for a HRSFANS retreat.

That person logged in with the following OpenID identifier:
    %s
...which may be more readable as their OpenID nickname:
    %s

If you would like to allow them to view and edit your registration, please go to:
    https://hrsfansretreat.appspot.com/authorize?token=%s

If you don't know who this person is, you can ignore this email, or complain to Andrew
at onethreeseven@gmail.com.  Hopefully we don't have a spam problem!

Cheers,
The HRSFANS Retreat Team
'''
    @ndb.transactional
    def send_email_if_necessary(self):
        '''
        Send a confirmation email if necessary.
        '''
        updated = self.key.get()
        if updated is not None and not updated.activated and not updated.email_token:
            token = ''.join(random.choice(string.letters) for i in xrange(40))
            updated.email_token = token
            updated.put()

            email = self.key.id()
            user = self.key.parent().id()
            logging.info('Sending authorization email: %r, %r', email, user)
            mail.send_mail(
                sender='HRSFANS Retreat Registration <onethreeseven@gmail.com>',
                to=email,
                subject='HRSFANS Retreat Registration Authorization Request',
                body=self.EMAIL_BODY % (user, self.user_nickname, token)
            )


class Registration(ndb.Model):
    '''
    A registration.

    Party <party name>
        Registration <email>
    '''
    # Core system data
    confirmed = ndb.BooleanProperty(required=True, default=False, indexed=False)
    # {id: 'yes' | 'no' | 'maybe'}
    meals = ndb.JsonProperty(required=True, default={}, compressed=True)
    name = ndb.TextProperty(required=True, default='')
    # {id: 'yes' | 'no'}
    nights = ndb.JsonProperty(required=True, default={}, compressed=True)

    # Personal data
    children = ndb.TextProperty(required=True, default='')
    dietary = ndb.TextProperty(required=True, default='')
    driving = ndb.TextProperty(required=True, default='')
    emergency = ndb.TextProperty(required=True, default='')
    full_name = ndb.TextProperty(required=True, default='')
    guest = ndb.TextProperty(required=True, default='')
    medical = ndb.TextProperty(required=True, default='')
    phone = ndb.TextProperty(required=True, default='')

    # Financial items; we use None here to indicate that the user has not entered anything yet
    aid = ndb.FloatProperty(indexed=False)
    aid_pledge = ndb.FloatProperty(indexed=False)
    subsidy = ndb.FloatProperty(indexed=False)

    @classmethod
    def create_or_save(cls, registration):
        '''
        Create or save the registration.  Does not validate the input!
        '''
        logging.info('Creating or modifying registration: %r', registration)
        obj = cls.get_or_insert(registration.pop('email'), parent=PARTY_KEY)
        obj.populate(**registration)
        obj.put()

    @classmethod
    def for_emails(cls, emails):
        '''
        Utility method: get all the Registration objects for the given emails.
        '''
        keys = [ndb.Key(Registration, email, parent=PARTY_KEY) for email in emails]
        return [x for x in ndb.get_multi(keys) if x is not None]

    @classmethod
    def update(cls, registration):
        '''
        Update the registration, raising LookupError if not present.
        '''
        logging.info('Modifying registration: %r', registration)
        obj = cls.get_by_id(registration.pop('email'), parent=PARTY_KEY)
        if obj is None:
            raise LookupError('Registration not found.')
        obj.populate(**registration)
        obj.put()

    def anon_dict(self):
        '''
        Return a dict representation of the object for anonymous users.

        Unlike most similar methods, this does not return the key ID (which is confidential).
        '''
        return self.to_dict(include=['name', 'nights'])

    def key_and_dict(self):
        '''
        Return a string from the object's key and a dict representation of the object.
        '''
        return self.key.id(), self.to_dict()


class AuthTombstone(ndb.Model):
    '''
    A record that an authorization was deleted, preventing it from being created automatically.

    Party <party name>
        User <federated identity>
            Authorization <email>
    '''
    # Doesn't actually store anything right now


class ReservationConflict(Exception):
    '''
    Exception used to signal that there was a conflict when attempting to save reservations.
    '''
    pass


class Reservation(ndb.Model):
    '''
    A room reservation.

    Party <party name>
        Reservation <night ID>|<room ID>

    Note: several comments below mention an Ugly Conspiracy.  This refers to the fact that we don't
    always enforce data consistency in reservations: if a user unregisters for a night, or a
    registration is deleted, we should delete the relevant reservations, but we don't bother.
    (If NDB supported foreign key constraints I might have done this differently.)

    Instead, at all points where we interact with the reservation table, we inspect the registration
    table and ignore any reservations that do not agree with the registrations.  In practice there
    are only three such points: the one setter for reservations, and the two global getters.
    '''
    registration = ndb.KeyProperty(kind=Registration, required=True)

    @classmethod
    def filter_by_registrations(cls, reservations, registrations):
        '''
        Filter the given reservations to remove ones that do not agree with the given registrations.

        This is used to implement the Ugly Conspiracy.
        '''
        nights_by_email = {reg.key: {k for k, v in reg.nights.iteritems() if v == 'yes'}
                           for reg in registrations}

        result = []
        for res in reservations:
            night, room = cls.split_key(res.key.id())
            if night in nights_by_email.get(res.registration, ()):
                result.append(res)
        return result

    @classmethod
    @ndb.transactional(retries=5)
    def process_request(cls, reservations, authorized_emails):
        '''
        Process a reservation request from the client.
        '''
        # Note that, as you would expect, NDB aborts the transaction if we raise an exception.
        logging.info('Beginning reservation transaction...')

        # Get a cache of registrations
        emails = {x for x in reservations.itervalues() if x}
        reg_cache = {reg.key.id(): reg for reg in Registration.for_emails(emails)}

        # Attempt to set the reservations.  Boy, there are a lot of things to check...
        for key, email in reservations.iteritems():
            night, room = cls.split_key(key)

            # Is there an existing reservation that we're not allowed to overwrite?
            res = cls.get_by_id(key, parent=PARTY_KEY)
            if res is not None:
                existing_email = res.registration.id()
                if existing_email not in authorized_emails:
                    # We have to check the registration, due to the Ugly Conspiracy
                    if existing_email not in reg_cache:
                        reg_cache[existing_email] = res.registration.get()
                    existing_reg = reg_cache[existing_email]
                    if existing_reg is not None and existing_reg.nights.get(night) == 'yes':
                        raise ReservationConflict('One or more rooms has been taken.')

            # If we've been asked to delete the reservation, we're clear to do that.
            if not email:
                if res is not None:
                    logging.info('Attempting to delete reservation %s.', key)
                    res.key.delete()

            # Otherwise...
            else:
                # Is the user allowed to reserve a room for this registration?
                if email not in authorized_emails:
                    raise ReservationConflict("You don't have authorization for a reservation.")
                # Is the room available that night?
                if room not in AVAILABLE_NIGHTS or night not in AVAILABLE_NIGHTS[room]:
                    raise ReservationConflict("Room is not available that night.")
                # Is the attendee actually staying that night?
                reg = reg_cache.get(email)
                if reg is None or reg.nights.get(night) != 'yes':
                    raise ReservationConflict("Attendee is not staying that night.")
                # Okay, they're clear to reserve the room.
                logging.info('Attempting to reserve %s for %r.', key, email)
                if res is None:
                    cls.get_or_insert(key, parent=PARTY_KEY, registration=reg.key)
                else:
                    res.registration = reg.key
                    res.put()

    @classmethod
    def split_key(cls, k):
        '''
        Utility method to split a key string into the night and room.
        '''
        return k.split('|', 1)

    def anon_dict(self, name_table):
        '''
        Return a dict representation of the object for anonymous users.

        Unlike most similar methods, this requires a table mapping registration keys to names.
        '''
        result = self.to_dict()
        result['registration'] = name_table.get(result['registration'])
        return self.key.id(), result

    def key_and_dict(self):
        '''
        Return a string from the object's key and a dict representation of the object.
        '''
        result = self.to_dict()
        result['registration'] = result['registration'].id()
        return self.key.id(), result


class Payment(ndb.Model):
    '''
    A payment record.

    Party <party name>
        Payment <arbitrary ID>
    '''
    amount = ndb.FloatProperty(required=True, indexed=False)
    date = ndb.DateTimeProperty(required=True, auto_now_add=True, indexed=False)
    from_whom = ndb.TextProperty(required=True, default='')
    via = ndb.TextProperty(required=True, default='')

    @classmethod
    @ndb.transactional
    def delete_by_id(cls, pmt_id):
        '''
        Delete the given payment and any associated credits.
        '''
        payment = cls.get_by_id(pmt_id, parent=PARTY_KEY)
        if payment is None:
            logging.warn('Failed to find payment (to delete) with id %r.', pmt_id)
            raise RuntimeError('Failed to find payment.')

        logging.info('Deleting payment: %r', payment.to_dict())
        payment.delete_credits()
        payment.key.delete()

    @classmethod
    @ndb.transactional
    def record_or_modify(cls, payment, credits, pmt_id=None):
        '''
        Record or modify a payment.
        '''
        # Get the previous payment if requested
        if pmt_id is not None:
            pmt_obj = cls.get_by_id(pmt_id, parent=PARTY_KEY)
            if pmt_obj is None:
                logging.warn('Failed to find payment (to modify) with id %r.', pmt_id)
                raise RuntimeError('Failed to find payment.')
            logging.info('Modifying payment: %r', pmt_obj.to_dict())
            pmt_obj.delete_credits()
        else:
            logging.info('Creating new payment.')
            pmt_obj = cls(parent=PARTY_KEY)

        logging.info('Saving new payment data: %r', payment)
        pmt_obj.populate(**payment)
        pmt_obj.put()

        emails = {credit['email'] for credit in credits}
        registrations = {reg.key.id(): reg for reg in Registration.for_emails(emails)}

        for credit in credits:
            reg = registrations.get(credit['email'])
            if reg is None:
                logging.warn('Failed to find registration for credit: %r', credit['email'])
                raise RuntimeError('Failed to find registration.')
            if not reg.confirmed:
                logging.warn('Registration for credit has not been confirmed: %r', credit['email'])
                raise RuntimeError('Registration has not been confirmed.')

            logging.info('Saving new credit data: %r' % credit)
            Credit(parent=pmt_obj.key, amount=credit['amount'], registration=reg.key).put()

    def delete_credits(self):
        '''
        Helper method for the delete and modify methods; deletes all credits for this payment.
        '''
        keys = Credit.query(ancestor=self.key).fetch(keys_only=True)
        logging.info('Deleting %d credits for payment.', len(keys))
        for key in keys:
            key.delete()

    def key_and_dict(self):
        '''
        Return an int from the object's key and a dict representation of the object.
        '''
        result = self.to_dict()
        result['date'] = result['date'].strftime('%Y-%m-%d %H:%M:%S')
        return self.key.id(), result


# Note: as with the Reservations, we hide some data inconsistency with Credits and Expenses.
# Nominally, only confirmed registrations can have credits or expenses attached; however, because
# NDB doesn't support foreign key constraints, we handle this by filterng out unconfirmed
# registrations in the getters and setters.  We refer to this as the Little Conspiracy.

class Credit(ndb.Model):
    '''
    A credit record.

    Party <party name>
        Payment <arbitrary ID>
            Credit <arbitrary ID>
    '''
    amount = ndb.FloatProperty(required=True, indexed=False)
    date = ndb.DateTimeProperty(required=True, auto_now_add=True, indexed=False)
    registration = ndb.KeyProperty(kind=Registration)

    def expanded_dict(self):
        '''
        Return a dict representation of the object.
        '''
        result = self.to_dict()
        result['date'] = result['date'].strftime('%Y-%m-%d')
        result['payment_id'] = self.key.parent().id()
        result['registration'] = result['registration'].id()
        return result


class Expense(ndb.Model):
    '''
    An expense record.

    Party <party name>
        Expense <arbitrary ID>
    '''
    amount = ndb.FloatProperty(required=True, indexed=False)
    categories = ndb.JsonProperty(required=True, default={}, compressed=True)
    date = ndb.DateTimeProperty(required=True, auto_now_add=True, indexed=False)
    description = ndb.TextProperty(required=True)
    registration = ndb.KeyProperty(kind=Registration)

    @classmethod
    def delete_by_id(cls, exp_id):
        '''
        Delete the given expense.
        '''
        expense = cls.get_by_id(exp_id, parent=PARTY_KEY)
        if expense is None:
            logging.warn('Failed to find expense (to delete) with id %r.', exp_id)
            raise RuntimeError('Failed to find expense.')
        logging.info('Deleting expense: %r', expense.to_dict())
        expense.key.delete()

    @classmethod
    def record_or_modify(cls, expense, exp_id=None):
        '''
        Record or modify an expense.
        '''
        # Get the previous expense if requested
        if exp_id is not None:
            exp_obj = cls.get_by_id(exp_id, parent=PARTY_KEY)
            if exp_obj is None:
                logging.warn('Failed to find expense (to modify) with id %r.', pmt_id)
                raise RuntimeError('Failed to find expense.')
            logging.info('Modifying expense: %r', exp_obj.to_dict())
        else:
            logging.info('Creating new expense.')
            exp_obj = cls(parent=PARTY_KEY)

        email = expense.pop('email')
        reg = Registration.get_by_id(email, parent=PARTY_KEY)
        if reg is None:
            logging.warn('Failed to find registration for expense: %r', email)
            raise RuntimeError('Failed to find registration.')
        if not reg.confirmed:
            logging.warn('Registration for expense has not been confirmed: %r', email)
            raise RuntimeError('Registration has not been confirmed.')
        if abs(sum(expense['categories'].itervalues()) - expense['amount']) > 0.005:
            logging.warn('Incosistent categorized amounts: %r', expense)
            raise RuntimeError('Sum of categorized amounts not equal to amount.')

        logging.info('Saving new expense data: %r, %r', email, expense)
        exp_obj.populate(registration=reg.key, **expense)
        exp_obj.put()

    def key_and_dict(self):
        '''
        Return an int from the object's key and a dict representation of the object.
        '''
        result = self.to_dict()
        result['date'] = result['date'].strftime('%Y-%m-%d')
        result['registration'] = result['registration'].id()
        return self.key.id(), result


def general_data():
    '''
    Data everyone needs.
    '''
    return {
        'party_data': PARTY_DATA
    }


# Helper constant for admin_data()
_CLASSES = (
    ('registrations', Registration),
    ('reservations', Reservation),
    ('payments', Payment),
    ('credits', Credit),
    ('expenses', Expense)
)

def admin_data():
    '''
    Data for admins.
    '''
    # Run the queries simultaneously
    futures = [(k, cls.query(ancestor=PARTY_KEY).fetch_async()) for k, cls in _CLASSES]
    results = {k: f.get_result() for k, f in futures}

    # Implement the Ugly Conspiracy
    results['reservations'] = Reservation.filter_by_registrations(results['reservations'],
                                                                  results['registrations'])

    # Implement the Little Conspiracy
    conf_keys = {obj.key for obj in results['registrations'] if obj.confirmed}
    results['credits'] = [obj for obj in results['credits'] if obj.registration in conf_keys]
    results['expenses'] = [obj for obj in results['expenses'] if obj.registration in conf_keys]

    # Build the result
    data = {
        'registrations': dict(obj.key_and_dict() for obj in results['registrations']),
        'reservations': dict(obj.key_and_dict() for obj in results['reservations']),
        'payments': dict(obj.key_and_dict() for obj in results['payments']),
        'credits': [obj.expanded_dict() for obj in results['credits']],
        'expenses': dict(obj.key_and_dict() for obj in results['expenses'])
    }

    return {'data': data}


def data_for_user(user):
    '''
    User data; pass the user's federated identity.
    '''
    # Launch large queries
    all_reg_future = Registration.query(ancestor=PARTY_KEY).fetch_async()
    all_res_future = Reservation.query(ancestor=PARTY_KEY).fetch_async()

    # Get the authorizations and registrations
    authorizations = Authorization.for_user(user)
    authorized_emails = Authorization.select_emails(authorizations)
    all_registrations = all_reg_future.get_result()
    registrations = [obj for obj in all_registrations if obj.key.id() in authorized_emails]

    # Get the credits and expenses, accounting for the Little Conspiracy
    conf_keys = [obj.key for obj in registrations if obj.confirmed]
    # App Engine refuses to run trivial queries
    if conf_keys:
        credits = Credit.query(Credit.registration.IN(conf_keys), ancestor=PARTY_KEY).fetch()
        expenses = Expense.query(Expense.registration.IN(conf_keys), ancestor=PARTY_KEY).fetch()
    else:
        credits = []
        expenses = []

    # Build the name table
    name_table = {obj.key: obj.name for obj in all_registrations}

    # Implement the Ugly Conspiracy; select the reservations for this user
    all_reservations = all_res_future.get_result()
    all_reservations = Reservation.filter_by_registrations(all_reservations, all_registrations)
    reservations = [res for res in all_reservations if res.registration.id() in authorized_emails]

    # Build the result
    anon_data = {
        'registrations': [obj.anon_dict() for obj in all_registrations if obj.confirmed],
        'reservations': dict(obj.anon_dict(name_table) for obj in all_reservations)
    }
    user_data = {
        'authorizations': dict(obj.key_and_dict() for obj in authorizations),
        'registrations': dict(obj.key_and_dict() for obj in registrations),
        'reservations': dict(obj.key_and_dict() for obj in reservations),
        'credits': [obj.expanded_dict() for obj in credits],
        'expenses': dict(obj.key_and_dict() for obj in expenses)
    }

    return {'user_data': user_data, 'anon_data': anon_data}

