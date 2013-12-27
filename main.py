'''
Dynamic endpoints.
'''
import logging
import json

from google.appengine.api import users
import webapp2

import model


class LoginRedirect(webapp2.RequestHandler):
    '''
    A stupid endpoint that exists only to redirect the default login URL to ours.
    '''
    def get(self):
        self.redirect('../login.html')


class OpenIDRedirect(webapp2.RequestHandler):
    '''
    The login page posts here; it redirects to the appropriate OpenID URL.
    '''
    def get(self):
        login_type = self.request.get('login_type')
        login_data = self.request.get('login_data')
        if login_type == 'google':
            url = users.create_login_url(federated_identity='https://www.google.com/accounts/o8/id')
        elif login_type == 'livejournal':
            url = users.create_login_url(federated_identity='%s.livejournal.com' % login_data)
        else:
            url = '/login.html'
        self.redirect(url)


class GetHandler(webapp2.RequestHandler):
    '''
    Generic GET method handler.
    '''
    def get(self):
        self.response.headers['Content-Type'] = 'application/json'
        self.response.write(json.dumps(self.process()))


class InitData(GetHandler):
    '''
    Returns static data.

    (But why then, you ask, is it not a static file?  I didn't feel like writing a YAML-to-JSON
    script and having to run it every time I changed the YAML.  Also this has the minor benefit
    of creating default users less often.)
    '''
    def process(self):
        user_obj = users.get_current_user()
        email = user_obj.email()
        user = user_obj.federated_identity() or email
        nickname = user_obj.nickname()

        # Create an authorization for the user if appropriate; Google emails can be trusted
        if user.startswith('https://www.google.com/'):
            model.Authorization.add(email, user, nickname, activate_immediately=True,
                                    respect_tombstone=True)

        result = model.general_data()
        result['user_nickname'] = nickname
        result['logout_url'] = users.create_logout_url('/login.html')
        result['is_admin'] = users.is_current_user_admin()
        return result


class MainData(GetHandler):
    '''
    Returns dynamic data for the main page.
    '''
    def process(self):
        user_obj = users.get_current_user()
        return model.data_for_user(user_obj.federated_identity() or user_obj.email())


class AdminData(GetHandler):
    '''
    Returns dynamic data for the admin page.
    '''
    def process(self):
        return model.admin_data()


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
            model.Authorization.add(email.strip(), user, users.get_current_user().nickname(),
                                    activate_immediately=users.is_current_user_admin())

        for email in message.get('remove', []):
            model.Authorization.remove(email, user)

        return ''


class Registrations(PostHandler):
    '''
    Creates or modifies registrations.
    '''
    REQUIRED_FIELDS = 'email name full_name phone nights transport_choice emergency'.split()

    def process(self, user, message):
        for registration in message:
            if not all(registration.get(k) for k in self.REQUIRED_FIELDS):
                return 'Missing a field.  How did you do that?'
            if not model.Authorization.is_authorized(registration['email'], user):
                return 'Authorization failure.  How did you do that?'
            if not any(value == 'yes' for value in registration['nights'].itervalues()):
                return 'No nights registered.  How did you do that?'

        for registration in message:
            model.Registration.create_or_save(registration)

        return ''


class Reservations(PostHandler):
    '''
    Modifies room reservations.
    '''
    def process(self, user, message):
        # Ensure room reservations are enabled
        if not (model.PARTY_DATA['reservations_enabled'] or users.is_current_user_admin()):
            logging.warn('Reserve endpoint hit while reservations were disabled.')
            return "Reservations aren't enabled yet.  How did you get here?"

        # Because we need to do this transactionally, we can't determine what rooms are already
        # reserved (and thus we are not permitted to reserve) from outside the model.  So in this
        # one case we delegate all the permissions checking.
        authorized_emails = model.Authorization.select_emails(model.Authorization.for_user(user))
        try:
            model.Reservation.process_request(message, authorized_emails)
        except model.ReservationConflict as e:
            logging.info('Reservation attempt failed with error "%s".', e)
            return str(e)

        logging.info('Reservation transaction successful.')
        return ''


class Finalize(PostHandler):
    '''
    Finalizes registrations.
    '''
    REQUIRED_FIELDS = 'email confirmed aid subsidy'.split()
    NUMERIC_FIELDS = 'adjustment aid aid_pledge subsidy'.split()

    def process(self, user, message):
        for registration in message:
            if any(registration.get(k) is None for k in self.REQUIRED_FIELDS):
                return 'Missing a field.  How did you do that?'
            if not model.Authorization.is_authorized(registration['email'], user):
                return 'Authorization failure.  How did you do that?'
            if not model.PARTY_DATA['reservations_enabled']:
                return 'Reservations not enabled.  How did you do that?'
            if 'adjustment' in registration and not users.is_current_user_admin():
                return 'Only admins can set financial adjustments.  How did you do that?'
            for field in self.NUMERIC_FIELDS:
                if registration.get(field) is not None:
                    registration[field] = float(registration[field])

        failed = False
        for registration in message:
            try:
                model.Registration.update(registration)
            except LookupError:
                failed = True
        if failed:
            return 'One or more registrations were not found.  How did you do that?'

        return ''


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
        pmt_id = message.pop('id', None)
        if pmt_id is not None:
            pmt_id = int(pmt_id)
        model.Payment.record_or_modify(message, message.pop('credits'), pmt_id=pmt_id)
        return ''


class DeletePayment(AdminPostHandler):
    '''
    Deletes a payment.
    '''
    def process(self, message):
        model.Payment.delete_by_id(int(message['id']))
        return ''


class RecordExpense(AdminPostHandler):
    '''
    Records or edits an expense.
    '''
    def process(self, message):
        exp_id = message.pop('id', None)
        if exp_id is not None:
            exp_id = int(exp_id)
        model.Expense.record_or_modify(message, exp_id=exp_id)
        return ''


class DeleteExpense(AdminPostHandler):
    '''
    Deletes an expense.
    '''
    def process(self, message):
        model.Expense.delete_by_id(int(message['id']))
        return ''


class Authorizer(webapp2.RequestHandler):
    '''
    Processes an authorization link.
    '''
    def get(self):
        token = self.request.get('token')
        if token and model.Authorization.process_token(token):
            self.response.write(
                "Authorization granted.  The person registering you for the party should refresh "
                "the page to continue."
            )
        else:
            self.abort(403)


application = webapp2.WSGIApplication([
    ('/_ah/login_required', LoginRedirect),
    ('/openid_redirect', OpenIDRedirect),
    ('/call/init', InitData),
    ('/call/main', MainData),
    ('/call/admin/main', AdminData),
    ('/call/authorizations', Authorizations),
    ('/call/registrations', Registrations),
    ('/call/reservations', Reservations),
    ('/call/finalize', Finalize),
    ('/call/admin/record_payment', RecordPayment),
    ('/call/admin/delete_payment', DeletePayment),
    ('/call/admin/record_expense', RecordExpense),
    ('/call/admin/delete_expense', DeleteExpense),
    ('/authorize', Authorizer)
])

