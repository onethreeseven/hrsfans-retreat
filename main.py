import logging
import json
import time

from google.appengine.api import users
import webapp2

import model


def parses_as_float(s):
    '''
    Determine if the string can be parsed by Python as a float.

    Does the right thing with None.
    '''
    if s is None:
        return False
    try:
        float(s)
    except ValueError:
        return False
    return True


class InitData(webapp2.RequestHandler):
    '''
    Returns static data.

    (But why then, you ask, is it not a static file?  I didn't feel like writing a YAML-to-json
    script and having to run it every time I changed the YAML.  Also this has the minor benefit
    of running create_default_for_user() less often.)
    '''
    def get(self):
        user_obj = users.get_current_user()
        user = user_obj.federated_identity() or user_obj.email()
        nickname = user_obj.nickname()

        # Create an attendee for the user if appropriate
        model.Attendee.create_default_for_user(user_obj.email(), user, nickname)
        result = model.general_data()
        result['user_nickname'] = nickname
        result['logout_url'] = users.create_logout_url('/login.html')

        self.response.headers['Content-Type'] = 'application/json'
        self.response.write(json.dumps(result))


class MainData(webapp2.RequestHandler):
    '''
    Returns dynamic data for the main page.
    '''
    def get(self):
        user_obj = users.get_current_user()
        user = user_obj.federated_identity() or user_obj.email()

        result = model.data_for_user(user)

        self.response.headers['Content-Type'] = 'application/json'
        self.response.write(json.dumps(result))


class PostHandler(webapp2.RequestHandler):
    '''
    Generic POST method handler.
    '''
    def post(self):
        user_obj = users.get_current_user()
        user = user_obj.federated_identity() or user_obj.email()

        message = json.loads(self.request.get('message'))
        return_message = self.process(user, message)
        result = model.data_for_user(user)
        result['error'] = return_message

        self.response.headers['Content-Type'] = 'application/json'
        self.response.write(json.dumps(result))


class Authorizations(PostHandler):
    '''
    Requests or releases authorizations.
    '''
    def process(self, user, message):
        for email in message.get('add', []):
            model.Authorization.add(email.strip(), user, users.get_current_user().nickname())

        for email in message.get('remove', []):
            model.Authorization.drop(email.strip(), user)

        return ''


class Register(PostHandler):
    '''
    Creates or modifies registrations.
    '''
    def process(self, user, message):
        for registration in message:
            if 'email' not in registration:
                return 'I got a registration with no email.  How did do that?'

            if not model.Authorization.is_authorized(registration['email'], user):
                return 'Authorization failure.  How did you do that?'

            # This mostly mirrors Registration.has_error in the Coffeescript, but we check again on
            # the principle of not trusting the user.
            required_fields = ('name', 'nights', 'meals', 'attendee_data', 'registration_data')
            if not all(registration.get(k) for k in required_fields):
                return 'Missing a field.  How did you do that?'
            if not any(value == 'yes' for value in registration['nights'].itervalues()):
                return 'No nights registered.  How did you do that?'

            attendee_data = registration['attendee_data']
            if not all(attendee_data.get(k) for k in ('full_name', 'phone', 'emergency')):
                return 'Mandatory attendee data field missing.  How did you do that?'

            registration_data = registration['registration_data']

        for registration in message:
            model.Registration.create_or_save(
                registration['email'],
                registration['name'],
                registration['nights'],
                registration['meals'],
                registration['attendee_data'],
                registration['registration_data']
            )

        return ''


class Reserve(PostHandler):
    '''
    Modifies room reservations.
    '''
    def process(self, user, message):
        # This is a clean hook for enabling room reservations
        if not model.PARTY_DATA['reservations_enabled']:
            logging.warn('Reserve endpoint hit while reservations were disabled.')
            return "Reservations aren't enabled yet.  How did you get here?"

        # This call cannot be transactional, because it requires attendees, which do not have
        # the Party as an ancestor.  On the other hand, it just reads the authorization list;
        # if we get an old authorization list the worst that happens is we spuriously reject
        # the request.
        _, authorized = model.Authorization.authorization_status_for_user(user)
        authorized = set(authorized)

        # Another thing we can do non-transactionally is verify that the user is authorized on all
        # the emails in the request, and that all the rooms actually exist
        reservations = message['reservations']
        to_complete = message['complete']
        to_uncomplete = message['uncomplete']

        for email in reservations.values() + to_complete + to_uncomplete:
            if email and email not in authorized:
                logging.warn('Failed to process reservation due to authorization error: %r.' % l)
                return "You tried to modify an email you're not authorized for.  How?"

        for k in reservations:
            night, room = model.Reservation.split_key(k)
            if night not in model.NIGHTS or room not in model.ROOM_COSTS:
                logging.warn('Failed to process reservation due to ID error: %s.' % k)
                return 'You tried to access a nonexistent night or room.  How?'

        # The rest has to be done transactionally
        try:
            model.Reservation.process_request(reservations, to_complete, to_uncomplete, authorized)
        except model.ReservationConflict as e:
            logging.info('Reservation attempt failed with error "%s".' % e)
            return str(e)

        logging.info('Reservation transaction successful.')
        return ''


class Financial(PostHandler):
    '''
    Modifies financial data.
    '''
    def process(self, user, message):
        for item in message:
            if 'email' not in item:
                return 'I got a request with no email.  How did do that?'

            if not model.Authorization.is_authorized(item['email'], user):
                return 'Authorization failure.  How did you do that?'

            financial_data = item['financial_data']
            fields = set(('transport_amount', 'assistance_amount', 'assistance_pledge'))
            if not fields.issuperset(financial_data):
                return 'Unexpected field(s).  How did you do that?'
            for numeric_field in ('transport_amount', 'assistance_amount'):
                if financial_data.get(numeric_field) is None:
                    financial_data[numeric_field] = 0.0
                else:
                    financial_data[numeric_field] = float(financial_data[numeric_field])

        for item in message:
            model.Registration.set_financial_data(
                item['email'],
                item['financial_data']
            )

        return ''


class Authorizer(webapp2.RequestHandler):
    '''
    Processes an authorization link.
    '''
    def get(self):
        token = self.request.get('token')
        if model.Authorization.process_token(token):
            self.response.write(
                "Authorization granted.  The person registering you for the party should"
                " refresh the page to continue."
            )
        else:
            self.abort(403)


class AdminData(webapp2.RequestHandler):
    '''
    Returns dynamic data for the admin page.
    '''
    def get(self):
        result = model.admin_data()
        self.response.headers['Content-Type'] = 'application/json'
        self.response.write(json.dumps(result))


class AdminPostHandler(webapp2.RequestHandler):
    '''
    Generic POST method handler (for admin endpoints).
    '''
    def post(self):
        message = json.loads(self.request.get('message'))
        return_message = self.process(message)
        result = model.admin_data()
        result['error'] = return_message

        self.response.headers['Content-Type'] = 'application/json'
        self.response.write(json.dumps(result))


class RecordPayment(AdminPostHandler):
    '''
    Records or edits a payment (and credits).
    '''
    def process(self, message):
        model.Payment.record_or_modify(
            message['amount'],
            message['extra_data'],
            message['credits'],
            pmt_id=message.get('id')
        )
        return ''


class DeletePayment(AdminPostHandler):
    '''
    Deletes a payment.
    '''
    def process(self, message):
        model.Payment.delete_by_id(message['id'])
        return ''


class LoginRedirect(webapp2.RequestHandler):
    '''
    This is a stupid endpoint that exists only to redirect the default login URL to ours.
    '''
    def get(self):
        self.redirect('../login.html')


class OpenIDRedirect(webapp2.RequestHandler):
    '''
    This is where login.html posts to; it redirects to the appropriate OpenID URL.
    '''
    def get(self):
        login_type = self.request.get('login_type')
        login_data = self.request.get('login_data')
        if login_type == 'google':
            federated_identity = 'https://www.google.com/accounts/o8/id'
            redirect_url = users.create_login_url(federated_identity=federated_identity)
        elif login_type == 'livejournal':
            federated_identity = '%s.livejournal.com' % login_data
            redirect_url = users.create_login_url(federated_identity=federated_identity)
        else:
            redirect_url = '/login.html'
        self.redirect(redirect_url)


class TemporaryAdjuster(webapp2.RequestHandler):
    '''
    Temporary: add an adjustment to a registration.  Eventually we'll have actual UI for this.
    '''
    def get(self):
        email = self.request.get('email')
        amount = float(self.request.get('amount'))
        reg = model.Registration.get_for_email(email)
        reg.financial_data['adjustment_amount'] = amount
        logging.info('Setting adjustment for %r to $%0.2f.', email, amount)
        reg.put()

        self.response.write('Okay.')


class TemporaryCarpoolPrinter(webapp2.RequestHandler):
    '''
    Temporary: print out the carpool information.  I think that this field should just go away in
    the next version.
    '''
    def get(self):
        registrations, active, reserved = model.Registration.registration_status_list()
        result = []
        for reg in registrations:
            data = reg.get('registration_data')
            if not data:
                continue
            driving = data.get('driving')
            if not driving:
                continue
            result.append((reg['name'], driving))
        result.sort(key=lambda (name, driving): name.lower())

        text = []
        for name, driving in result:
            text.append(name + '\n' + driving + '\n')
        self.response.write('\n'.join(text))
        self.response.content_type = 'text/plain'


application = webapp2.WSGIApplication([
    ('/_ah/login_required', LoginRedirect),
    ('/openid_redirect', OpenIDRedirect),
    ('/authorize', Authorizer),
    ('/call/init', InitData),
    ('/call/main', MainData),
    ('/call/authorizations', Authorizations),
    ('/call/register', Register),
    ('/call/reserve', Reserve),
    ('/call/financial', Financial),
    ('/call/admin/main', AdminData),
    ('/call/admin/record_payment', RecordPayment),
    ('/call/admin/delete_payment', DeletePayment),

    # Temporary endpoints until we have the time to do it properly
    ('/call/admin/temp-adjust', TemporaryAdjuster),
    ('/call/admin/temp-carpool', TemporaryCarpoolPrinter),
])

