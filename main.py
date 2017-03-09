'''
Dynamic endpoints.
'''
from __future__ import unicode_literals

import json
import logging
import time
import webapp2
from google.appengine.api import users

import model
from model import APIError


# Helper functions for dealing with enabling reservations
def _are_reservations_enabled():
    return time.time() > model.PARTY_DATA['enable_reservations_after']

def _assert_reservations_enabled():
    if not _are_reservations_enabled() and not users.is_current_user_admin():
        raise APIError('Reservations not yet enabled.')


# Helper function: get the group for the current user
def _group():
    return model.Registration.group_for_user(users.get_current_user().email())


# Helper function: get model data for the given group
def _model_data(group):
    if users.is_current_user_admin():
        result = model.all_data()
    else:
        result = model.all_data(group=group)
    result['group'] = group
    return result


class Init(webapp2.RequestHandler):
    '''
    Returns the data needed to initialize the page.
    '''
    def get(self):
        result = {
            'is_admin': users.is_current_user_admin(),
            'logout_url': users.create_logout_url('/'),
            'party_data': dict(model.PARTY_DATA, reservations_enabled=_are_reservations_enabled()),
            'server_data': _model_data(_group()),
            'username': users.get_current_user().email()
        }

        self.response.headers[b'Content-Type'] = b'application/json'
        self.response.write(json.dumps(result))


class PostHandler(webapp2.RequestHandler):
    '''
    Generic POST method handler.
    '''
    def post(self):
        message = json.loads(self.request.body)
        message_group = message.pop('group')
        group = message_group if users.is_current_user_admin() else _group()

        try:
            self.process(message, group)
        except APIError as e:
            logging.info('Error processing request: "%s"', e)
            error = str(e)
        else:
            logging.info('Request successful.')
            error = None
        result = {'server_data': _model_data(group), 'error': error}

        self.response.headers[b'Content-Type'] = b'application/json'
        self.response.write(json.dumps(result))


class CreateRegistration(PostHandler):
    '''
    Creates a registration.
    '''
    def process(self, message, group):
        model.Registration.create(message['name'], message.get('email'), group)


class UpdateRegistration(PostHandler):
    '''
    Updates a registration.
    '''
    def process(self, message, group):
        if message.get('confirmed'):
            _assert_reservations_enabled()
        model.Registration.update(message, group)


class DeleteRegistration(PostHandler):
    '''
    Deletes a registration.
    '''
    def process(self, message, group):
        model.Registration.delete(message['name'], group)


class UpdateReservations(PostHandler):
    '''
    Updates room reservations.
    '''
    def process(self, message, group):
        _assert_reservations_enabled()
        model.Reservation.process_request(message, group)


class RecordCreditGroup(PostHandler):
    '''
    Creates or updates a credit group and credits.
    '''
    def process(self, message, group):
        model.CreditGroup.create_or_replace(message, message.pop('credits'),
                                            credit_group_id=message.pop('id', None))


class DeleteCreditGroup(PostHandler):
    '''
    Deletes a credit group.
    '''
    def process(self, message, group):
        model.CreditGroup.delete(message['id'])


class RecordCredit(PostHandler):
    '''
    Creates or updates a credit.
    '''
    def process(self, message, group):
        model.Credit.create_or_update(message, credit_id=message.pop('id', None))


class DeleteCredit(PostHandler):
    '''
    Deletes a credit.
    '''
    def process(self, message, group):
        model.Credit.delete(int(message['id']))


application = webapp2.WSGIApplication([
    ('/call/init', Init),
    ('/call/create_registration', CreateRegistration),
    ('/call/update_registration', UpdateRegistration),
    ('/call/delete_registration', DeleteRegistration),
    ('/call/update_reservations', UpdateReservations),
    ('/call/admin/record_credit_group', RecordCreditGroup),
    ('/call/admin/delete_credit_group', DeleteCreditGroup),
    ('/call/admin/record_credit', RecordCredit),
    ('/call/admin/delete_credit', DeleteCredit),
])

