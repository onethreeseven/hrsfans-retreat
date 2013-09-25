class LoginPageModel
    constructor: ->
        @login_type = ko.observable()

        # Leave this missing to suppress the data box altogether
        @data_label = ko.computed => {
            'livejournal': 'User name:'
        }[@login_type()]

$(document).ready =>
    ko.applyBindings new LoginPageModel()
