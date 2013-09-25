'''
Data model and associated utility functions.
'''
import itertools
import logging
import random
import string
import yaml

from google.appengine.api import mail, users
from google.appengine.ext import ndb

PARTY_NAME = 'Winter Retreat 2014'
PARTY_DATA = yaml.load(open('data/%s.yaml' % PARTY_NAME))

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
    for group in PARTY_DATA['rooms'].itervalues():
        _normalize_ids(group)

normalize_party_data()
NIGHTS = {day['id'] for day in PARTY_DATA['days'][:-1]}
ROOM_COSTS = {rm['id']: rm['cost'] for group in PARTY_DATA['rooms'].itervalues() for rm in group}


class Party(ndb.Model):
    '''
    A party.

    Party <party name>
    '''
    # This doesn't actually store anything right now, but it could...

THIS_PARTY_KEY = ndb.Key(Party, PARTY_NAME)


class Attendee(ndb.Model):
    '''
    An attendee.  Note that this does not have the party as an ancestor.

    Attendee <email>
    '''
    name = ndb.StringProperty(indexed=False)
    extra_data = ndb.JsonProperty(compressed=True, required=True, default={})

    @classmethod
    def create_default_for_user(cls, email, user, nickname):
        '''
        Users logging in with Google accounts automatically get attendees with permissions.
        '''
        # Non-Google emails can't be trusted (and are often not even emails)
        if user is None or not user.startswith('https://www.google.com/'):
            return
        logging.info('Creating default attendee if required: %r, %r' % (email, user))
        att = cls.get_or_insert(email)
        Authorization.get_or_insert(user, parent=att.key, activated=True, user_nickname=nickname)

    def email(self):
        '''
        Get the email address for this attendee.
        '''
        return self.key.string_id()


class Authorization(ndb.Model):
    '''
    Authorization for a user to see the attendee.

    Attendee <email>
        Authorization <federated identity ('user')>
    '''
    activated = ndb.BooleanProperty(required=True, default=False, indexed=False)
    user_nickname = ndb.StringProperty(indexed=False)
    email_token = ndb.StringProperty()

    @classmethod
    def authorization_status_for_user(cls, user):
        '''
        Get the full authorization status for the user.

        Returns a list of dictionaries with two keys, 'email' and 'status', for return.
        Also returns a sorted list of just the active authorized emails.
        '''
        status = []
        authorized = []

        # Terrible optimization; this looping is only necessary because the key is backwards
        # (we often need to query all the attendees authorized on a user, never vice versa)
        authorizations = {a.email(): a for a in cls.query() if a.user() == user}

        for attendee in Attendee.query():
            email = attendee.email()
            authorization = authorizations.get(email)
            if authorization is not None:
                this_status = {'email': email}
                if authorization.activated:
                    this_status['status'] = 'Active'
                    this_status['active'] = True
                    authorized.append(email)
                elif authorization.email_token:
                    this_status['status'] = 'Pending email response'
                    this_status['active'] = False
                else:
                    this_status['status'] = 'Email rejected or not yet sent'
                    this_status['active'] = False
                status.append(this_status)
        authorized.sort()
        return status, authorized

    @classmethod
    def add(cls, email, user, nickname):
        '''
        Add the specified authorization and send email if necessary.
        '''
        logging.info('Attempting to add authorization: %r, %r' % (email, user))
        attendee = Attendee.get_or_insert(email)
        authorization = cls.get_or_insert(
            user,
            user_nickname=nickname,
            parent=attendee.key,
            activated=users.is_current_user_admin()
        )
        authorization.send_email_if_necessary()

    @classmethod
    def drop(cls, email, user):
        '''
        Drop the specified authorization if it exists.
        '''
        logging.info('Attempting to drop authorization: %r, %r' % (email, user))
        ndb.Key(Attendee, email, cls, user).delete()

    @classmethod
    def is_authorized(cls, email, user):
        '''
        Report whether the given authorization exists and is activated.
        '''
        attendee = Attendee.get_by_id(email)
        if attendee is None:
            return False
        authorization = cls.get_by_id(user, parent=attendee.key)
        if authorization is None:
            return False
        return authorization.activated

    @classmethod
    def process_token(cls, token):
        '''
        Activate the authorization with the given token.  Reports the number activated.
        '''
        processed = 0
        if token is not None:
            for authorization in cls.query(cls.email_token == token):
                authorization.activated = True
                authorization.email_token = None
                authorization.put()
                processed += 1
        return processed

    def email(self):
        '''
        Get the attendee email address.
        '''
        return self.key.parent().string_id()

    def user(self):
        '''
        Get the user identifier.
        '''
        return self.key.string_id()

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
        if not updated.activated and not updated.email_token:
            token = ''.join(random.choice(string.letters + string.digits) for i in xrange(40))
            updated.email_token = token
            updated.put()
            token = updated.email_token

            email = self.email()
            if email is None:
                return
            logging.info('Sending authorization email to %r for user %r.' % (email, self.user()))
            mail.send_mail(
                sender='HRSFANS Retreat Registration <onethreeseven@gmail.com>',
                to=email,
                subject='HRSFANS Retreat Registration Authorization Request',
                body=self.EMAIL_BODY % (self.user(), self.user_nickname, token)
            )


class Registration(ndb.Model):
    '''
    Registration entry.

    Party <party name>
        Registration <email>  # Attendee is a pseudoancestor
    '''
    nights = ndb.JsonProperty(compressed=True, required=True, default={})
    meals = ndb.JsonProperty(compressed=True, required=True, default={})
    rooms_reserved = ndb.BooleanProperty(required=True, default=False)
    financial_data = ndb.JsonProperty(compressed=True, required=True, default={})
    extra_data = ndb.JsonProperty(compressed=True, required=True, default={})

    @classmethod
    def get_for_email(cls, email):
        '''
        Get the registration for the given email, if it exists.
        '''
        return cls.get_by_id(email, parent=THIS_PARTY_KEY)

    @classmethod
    def guest_list(cls):
        '''
        Gets all the attendees with the nights they're staying.
        '''
        # Optimization: get all the data only once (and in parallel)
        att_query = Attendee.query().fetch_async()
        reg_query = cls.query(ancestor=THIS_PARTY_KEY).fetch_async()
        attendees = {x.email(): x for x in att_query.get_result()}

        result = []
        for reg in reg_query.get_result():
            attendee = attendees.get(reg.key.string_id())
            if attendee is None:
                continue
            result.append({
                'name': attendee.name,
                'nights': reg.selected_nights()
            })
        result.sort(key=lambda x: x.get('name').lower())
        return result

    @classmethod
    def registration_status_list(cls, emails=None):
        '''
        Get the registration status as a list, for all attendees (default) or the specified emails.

        Returns three items:

        First, a list of dictionaries with the following keys:
            'email': email address
            'name': nickname
            'attendee_data': additional data associated with the attendee
            'nights': dict from night id to 'no' or 'yes'
            'meals': dict from meal id to 'no', 'maybe', or 'yes'
            'registration_data': additional data associated with the registration

        Second, a list of registrations that are ready to reserve rooms.  These contain the email,
        the name, a list of nights, and a Boolean indicating whether the reservation is complete.

        Third, a list of registrations which have reserved rooms.  These contain the email, the
        name, the financial data, lists of costs / adjustments and credits, and the amount due.
        '''
        registrations = []
        active_registrations = []
        reserved_registrations = []

        if emails is None:
            attendees = list(Attendee.query())
        else:
            attendees = []
            for email in emails:
                attendee = Attendee.get_by_id(email)
                if attendee is not None:
                    attendees.append(attendee)
        attendees.sort(key=lambda a: (a.name or '').lower())

        # Optimization: queue these up now
        reg_futures = [cls.get_by_id_async(a.email(), parent=THIS_PARTY_KEY) for a in attendees]

        for attendee, reg_future in itertools.izip(attendees, reg_futures):
            email = attendee.email()
            this_reg = {}
            this_reg['email'] = email
            this_reg['name'] = attendee.name
            this_reg['attendee_data'] = attendee.extra_data

            registration = reg_future.get_result()
            if registration is not None:
                this_reg['nights'] = registration.nights
                this_reg['meals'] = registration.meals
                this_reg['registration_data'] = registration.extra_data

                active_registrations.append({
                    'email': email,
                    'name': attendee.name,
                    'nights': registration.selected_nights(),
                    'reserved': registration.rooms_reserved
                })

                if registration.rooms_reserved:
                    costs = registration.costs()
                    cost_list = []
                    cost_list.append({
                        'label': 'Meals',
                        'value': costs['meals'],
                        'category': 'meals'
                    })
                    cost_list.append({
                        'label': 'Rooms',
                        'value': costs['rooms'],
                        'category': 'rooms'
                    })
                    if costs['independent']:
                        cost_list.append({
                            'label': 'Party supplies charge',
                            'value': costs['independent'],
                            'category': 'rooms'
                        })
                    if costs['transport']:
                        label = 'contribution' if costs['transport'] > 0 else 'request'
                        cost_list.append({
                            'label': 'Transport subsidy %s' % label,
                            'value': costs['transport'],
                            'category': 'transport'
                        })
                    if costs['assistance']:
                        label = 'contribution' if costs['assistance'] > 0 else 'request'
                        cost_list.append({
                            'label': 'Financial assistance %s' % label,
                            'value': costs['assistance'],
                            'category': 'assistance'
                        })
                    if costs['adjustment']:
                        cost_list.append({
                            'label': 'Administrative adjustment',
                            'value': costs['adjustment'],
                            'category': 'adjustment'
                        })

                    credits = Credit.query(
                        Credit.registration == registration.key,
                        ancestor=THIS_PARTY_KEY
                    )
                    credit_list = []
                    for credit in credits:
                        credit_list.append({
                            'label': credit.date.strftime('Payment / (refund) recorded %b %d'),
                            'value': credit.amount
                        })

                    reserved_registrations.append({
                        'email': email,
                        'name': attendee.name,
                        'costs': cost_list,
                        'credits': credit_list,
                        'financial_data': registration.financial_data,
                        'due': sum(x['value'] for x in cost_list) -
                               sum(x['value'] for x in credit_list)
                    })

            registrations.append(this_reg)

        return registrations, active_registrations, reserved_registrations

    @classmethod
    def create_or_save(cls, email, name, nights, meals, attendee_data, registration_data):
        '''
        Create or save the registration.  Does not validate the input!
        '''
        attendee = Attendee.get_by_id(email)
        if attendee is None:
            # The caller should have made sure we don't get here, but...
            raise RuntimeError('Failed to find attendee after validation.  What?!')

        logging.info('Creating or modifying registration:')
        logging.info('    email: %r' % email)
        logging.info('    name: %r' % name)
        logging.info('    nights: %r' % nights)
        logging.info('    meals: %r' % meals)
        logging.info('    attendee_data: %r' % attendee_data)
        logging.info('    registration_data: %r' % registration_data)

        attendee.name = name
        attendee.extra_data = attendee_data

        registration = cls.get_or_insert(email, parent=THIS_PARTY_KEY)
        registration.nights = nights
        registration.meals = meals
        registration.extra_data = registration_data

        attendee.put()
        registration.put()

    @classmethod
    def set_financial_data(cls, email, financial_data):
        '''
        Set the financial data for the registration with the given email.

        Discards emails without registrations (logging a warning); this is probably good enough.
        '''
        registration = cls.get_for_email(email)

        if registration is None:
            logging.warn('Tried to set financial data for %r, but found no registration.' % email)
            return

        logging.info('Setting financial data for %r:' % email)
        logging.info('    data: %r' % financial_data)

        registration.financial_data = financial_data
        registration.put()

    def attendee(self):
        '''
        Get the attendee object for this registration.
        '''
        return Attendee.get_by_id(self.key.string_id())

    def costs(self):
        '''
        Get the costs for this registration.

        Returns a dictionary with keys 'meals', 'rooms', 'independent', 'transport', and
        'assistance'.
        '''
        result = {}

        meal_charges = 0
        for meal in PARTY_DATA['meals']:
            if self.meals[meal['id']] == 'yes':
                meal_charges += meal['cost']
        result['meals'] = meal_charges

        room_charges = {night: 0 for night in self.selected_nights()}
        night_reserved = {night: False for night in room_charges}
        reservations = Reservation.query(
            Reservation.registration == self.key,
            ancestor=THIS_PARTY_KEY
        )
        for res in reservations:
            night, room = res.night_and_room()
            # Deleted nights leave behind ghost registrations which the getters and setters
            # conspire to hide from view.  This is kind of ugly.
            if night in room_charges:
                room_charges[night] += ROOM_COSTS[room]
                night_reserved[night] = True
        result['rooms'] = sum(room_charges.itervalues())

        extra_nights = sum(1 for k, v in room_charges.iteritems() if not night_reserved[k])
        result['independent'] = PARTY_DATA['independent_night_cost'] * extra_nights

        result['transport'] = self.financial_data.get('transport_amount', 0.0)
        result['assistance'] = self.financial_data.get('assistance_amount', 0.0)
        result['adjustment'] = self.financial_data.get('adjustment_amount', 0.0)

        return result

    def selected_nights(self):
        '''
        Get the nights that are selected.
        '''
        return [k for k, v in self.nights.iteritems() if v == 'yes']


class ReservationConflict(Exception):
    '''
    Exception used to signal that there was a conflict when attempting to save reservations.
    '''
    pass


class Reservation(ndb.Model):
    '''
    Reservation.

    Party <party name>
        Reservation <night ID>|<room ID>
    '''
    # This gets set if the room is unavailable on the given day
    unavailable = ndb.BooleanProperty(required=True, default=False, indexed=False)
    update_date = ndb.DateTimeProperty(required=True, auto_now_add=True, indexed=False)
    registration = ndb.KeyProperty(kind=Registration)

    @classmethod
    def list_reservations(cls, authorized_emails):
        '''
        List all the reservations.

        Returns two dictionaries:
            {<night ID>|<room ID>: nickname} for emails not in authorized_emails
            {<night ID>|<room ID>: email} for emails in authorized emails
        A blank nickname in the first dictionary indicates an unavailable room.

        For convenience on the client side, the return value is a single dictionary with the keys
        'unauthorized' and 'authorized'.
        '''
        unauthorized_result = {}
        authorized_result = {}

        # Optimization: get all the data only once (and in parallel)
        att_future = Attendee.query().fetch_async()
        reg_future = Registration.query(ancestor=THIS_PARTY_KEY).fetch_async()
        res_future = cls.query(ancestor=THIS_PARTY_KEY).fetch_async()
        attendees = {x.email(): x for x in att_future.get_result()}
        registrations = {x.key: x for x in reg_future.get_result()}

        show_names = users.is_current_user_admin()

        for reservation in res_future.get_result():
            night, room = reservation.night_and_room()
            if night not in NIGHTS or room not in ROOM_COSTS:
                # This means some kind of data corruption (or party data changed); ignore
                continue

            key = reservation.key.string_id()
            if reservation.unavailable:
                unauthorized_result[key] = ''
                continue

            registration = registrations.get(reservation.registration)
            if registration is None:
                continue
            # Deleted nights leave behind ghost registrations which the getters and setters
            # conspire to hide from view.  This is kind of ugly.
            if registration.nights.get(night) != 'yes':
                continue

            email = registration.key.string_id()
            attendee = attendees.get(email)
            if attendee is None:
                continue

            if email in authorized_emails:
                authorized_result[key] = email
            else:
                if show_names:
                    unauthorized_result[key] = attendee.name
                else:
                    unauthorized_result[key] = 'Occupied'

        return {
            'unauthorized': unauthorized_result,
            'authorized': authorized_result
        }

    @classmethod
    @ndb.transactional(retries=5)
    def process_request(cls, reservations, to_complete, to_uncomplete, authorized_emails):
        '''
        Process a reservation request from the client.
        '''
        # By this time we've validated that the user has permissions on the emails in the request,
        # but we still need the set of authorized emails to check for overwrite permissions.
        # Note also that, as you would expect, NDB aborts the transaction if we raise an exception.
        logging.info('Beginning reservation transaction...')

        # Don't look up what is probably the same registration over and over
        reg_cache = {}
        for email in reservations.values() + to_complete + to_uncomplete:
            if email and email not in reg_cache:
                reg = Registration.get_for_email(email)
                if reg is None:
                    raise ReservationConflict('This reservation has no registration.  How?!')
                reg_cache[email] = reg

        # Attempt to set the reservations.  Boy, there are a lot of things to check...
        for key, email in reservations.iteritems():
            night, room = cls.split_key(key)

            # First, checks on the reservation.
            res = cls.get_by_id(key, parent=THIS_PARTY_KEY)
            if res is not None:
                # Is the room marked unavailable?
                if res.unavailable:
                    raise ReservationConflict('One or more rooms is unavailable.')

                # Is there an existing reservation that we're not allowed to overwrite?
                if res.registration is not None:
                    existing_reg = res.registration.get()
                    if (existing_reg is not None and
                        existing_reg.key.string_id() not in authorized_emails and
                        # Deleted nights leave behind ghost registrations which the getters and
                        # setters conspire to hide from view.  This is kind of ugly.
                        existing_reg.nights.get(night) == 'yes'):
                        raise ReservationConflict('One or more rooms has been taken.')

            # If we've been asked to delete the reservation, we're clear to do that.
            if not email:
                if res is not None:
                    logging.info('Attempting to delete reservation %s.' % key)
                    res.key.delete()

            # Otherwise...
            else:
                # ...we have to make sure they're actually staying that night.
                reg = reg_cache[email]
                if reg.nights.get(night) != 'yes':
                    raise ReservationConflict("You're not attending this night.  How?!")
                # Okay, they're clear to reserve the room.
                if res is None:
                    res = cls.get_or_insert(key, parent=THIS_PARTY_KEY)
                res.registration = reg.key
                logging.info('Attempting to reserve %s for %r.' % (key, email))
                res.put()

        # The rest is pretty easy.
        for email in to_complete:
            reg = reg_cache[email]
            reg.rooms_reserved = True
            logging.info('Attempting to mark rooms reserved for %r.' % email)
            reg.put()

        for email in to_uncomplete:
            reg = reg_cache[email]
            reg.rooms_reserved = False
            logging.info('Attempting to unmark rooms reserved for %r.' % email)
            reg.put()

    @classmethod
    def split_key(cls, k):
        '''
        Utility method to split a key string into the night and room.
        '''
        result = k.split('|')
        if len(result) != 2:
            raise RuntimeError('Invalid reservation key.')
        return result

    def night_and_room(self):
        '''
        Return the night ID and room ID for this reservation.
        '''
        return self.split_key(self.key.string_id())


class Payment(ndb.Model):
    '''
    Payment record.

    Party <party name>
        Payment <arbitrary ID>
    '''
    date = ndb.DateTimeProperty(required=True, auto_now_add=True, indexed=False)
    amount = ndb.FloatProperty(required=True, indexed=False)
    extra_data = ndb.JsonProperty(compressed=True, required=True, default={})

    @classmethod
    def list_payments_and_credits(cls):
        '''
        List the payments, with associated credits.

        Returns a list of dictionaries with the following keys:
            'id': key ID of the payment (so it can be edited)
            'date': date of payment in ISO format
            'amount': amount of payment
            'extra_data': the extra data object (currently, source and method of payment)
            'credits': a list of dictionaries with the following keys:
                'amount': amount of credit
                'email': email of credited registration
                'name': nickname associated with credited registration
        sorted from most to least recent.

        Note that credits associated with registrations that have not completed room reservations
        are not included.
        '''
        result = []

        # Optimization: get most of the data just once, use futures in general
        pmt_future = cls.query(ancestor=THIS_PARTY_KEY).fetch_async()
        reg_future = Registration.query(ancestor=THIS_PARTY_KEY).fetch_async()
        att_future = Attendee.query().fetch_async()

        payments = pmt_future.get_result()
        payments.sort(key=lambda p: p.date, reverse=True)
        payments_with_futures = [(p, Credit.query(ancestor=p.key).fetch_async()) for p in payments]

        registrations = {x.key: x for x in reg_future.get_result()}
        attendees = {x.email(): x for x in att_future.get_result()}

        for payment, future in payments_with_futures:
            this_result = {}
            this_result['id'] = payment.key.integer_id()
            this_result['date'] = payment.date.strftime('%Y-%m-%d')
            this_result['amount'] = payment.amount
            this_result['extra_data'] = payment.extra_data

            credits = []
            for credit in future.get_result():
                registration = registrations.get(credit.registration)
                if registration is None or not registration.rooms_reserved:
                    continue
                attendee = attendees.get(registration.key.string_id())
                if attendee is None:
                    continue
                this_credit = {}
                this_credit['amount'] = credit.amount
                this_credit['email'] = attendee.email()
                this_credit['name'] = attendee.name
                credits.append(this_credit)
            this_result['credits'] = credits

            result.append(this_result)

        return result


    @classmethod
    @ndb.transactional
    def record_or_modify(cls, amount, extra_data, credits, pmt_id=None):
        '''
        Record or modify a payment.

        Pass the amount, the extra_data dictionary, a list of credits (as a dictionary with keys
        'amount' and 'email'), and if desired the ID of the payment to modify.
        '''
        # Get the previous payment if requested
        if pmt_id is not None:
            payment = cls.get_by_id(pmt_id, parent=THIS_PARTY_KEY)
            if payment is None:
                logging.warn('Failed to find payment (to modify) with id %r.' % pmt_id)
                raise RuntimeError('Failed to find payment.')
            logging.info('Modifying payment from date %s.' % payment.date.strftime('%Y-%m-%d'))
            payment.delete_credits()
        else:
            logging.info('Creating new payment.')
            payment = Payment(parent=THIS_PARTY_KEY)

        logging.info('Saving new payment data:')
        logging.info('    amount: %.2f' % amount)
        logging.info('    extra_data: %r' % extra_data)

        payment.amount = amount
        payment.extra_data = extra_data
        payment.put()

        for credit in credits:
            reg = Registration.get_for_email(credit['email'])
            if reg is None:
                logging.warn('Failed to find registration for credit: %r' % credit['email'])
                raise RuntimeError('Failed to find registration.')
            if not reg.rooms_reserved:
                logging.warn('Registration for credit has not reserved rooms: %r' % credit['email'])
                raise RuntimeError('Registration has not reserved rooms.')

            logging.info('Saving new credit data:')
            logging.info('    amount: %.2f' % credit['amount'])
            logging.info('    email: %r' % credit['email'])
            Credit(parent=payment.key, amount=credit['amount'], registration=reg.key).put()


    @classmethod
    @ndb.transactional
    def delete_by_id(cls, pmt_id):
        '''
        Delete the given payment and any associated credits.
        '''
        payment = cls.get_by_id(pmt_id, parent=THIS_PARTY_KEY)
        if payment is None:
            logging.warn('Failed to find payment (to delete) with id %r.' % pmt_id)
            raise RuntimeError('Failed to find payment.')

        logging.info('Deleting payment from date %s.' % payment.date.strftime('%Y-%m-%d'))
        payment.key.delete()
        payment.delete_credits()


    def delete_credits(self):
        '''
        Helper method for the delete and modify methods; deletes all credits for this payment.
        '''
        credits = list(Credit.query(ancestor=self.key))
        logging.info('Deleting %d credits for payment.' % len(credits))
        for credit in credits:
            credit.key.delete()


class Credit(ndb.Model):
    '''
    Credit record.

    Party <party name>
        Payment <arbitrary ID>
            Credit <arbitrary ID>
    '''
    date = ndb.DateTimeProperty(required=True, auto_now_add=True, indexed=False)
    amount = ndb.FloatProperty(required=True, indexed=False)
    registration = ndb.KeyProperty(required=True, kind=Registration)


def general_data():
    '''
    Data everyone needs.
    '''
    return {
        'party_name': PARTY_NAME,
        'party_data': PARTY_DATA
    }


def admin_data():
    '''
    Data for admins.
    '''
    result = {}
    regs, active, reserved = Registration.registration_status_list()
    result['registrations'] = regs
    result['active'] = active
    result['reserved'] = reserved
    result['payments'] = Payment.list_payments_and_credits()
    return result


def data_for_user(user):
    '''
    Full state data for this user.
    '''
    result = {}
    authorizations, authorized_emails = Authorization.authorization_status_for_user(user)
    result['authorizations'] = authorizations
    regs, active, reserved = Registration.registration_status_list(emails=authorized_emails)
    result['registrations'] = regs
    # The active registrations come out of the Registration object but are needed
    # for the reservation tables; hence this nonsense.
    reservations = Reservation.list_reservations(authorized_emails)
    reservations['active_reg'] = active
    result['reservations'] = reservations
    result['reserved'] = reserved
    result['guest_list'] = Registration.guest_list()
    return result

