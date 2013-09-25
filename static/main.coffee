PageModel = window.registry.PageModel
FormSection = window.registry.FormSection


# Utility functions and classes

# Is this a valid floating-point number?  Used to validate money entries.
valid_float = (x) ->
    /^[0-9]+(\.[0-9]+)?$/.test(x ? '')

# Compare x and y, coercing null and undefined to the empty string.
eq = (x, y) ->
    (x ? '') == (y ? '')

# Compare x and y, coercing null and undefined to null.
eq_strict = (x, y) ->
    if not x?
        return not y?
    if not y?
        return false
    return x == y

# Storage for a table cell which toggles its value when clicked, and can cycle through styles
class ClickableCell
    # Internally this stores state as an index into the various arrays
    # TODO: change this from parallel arrays to an array of objects
    constructor: (options, initial, labels, styles) ->
        @options = options
        @labels = labels
        @styles = styles
        @initial = Math.max(@options.indexOf(initial), 0)
        @selected = ko.observable @initial
        @value = ko.computed @get_value
        @style = ko.computed @get_style
        @label = ko.computed @get_label
        @changed = ko.computed @get_changed

    get_changed: =>
        @selected() != @initial

    get_value: =>
        @options[@selected()]

    get_style: =>
        @styles[@selected()]

    get_label: =>
        @labels[@selected()]

    toggle: =>
        @selected((@selected() + 1) % @options.length)

# This is a dummy version of ClickableCell which allows the HTML to ignore the fact that some
# cells in the reservation table are in fact unclickable
class FixedCell
    constructor: (label, style) ->
        @label = label
        @style = style

    toggle: =>


# The main object backing the page.
class MainPageModel extends PageModel
    constructor: ->
        # As noted in PageModel, there is some initialization that needs to happen before...
        super()

        @select_attendees = new SelectAttendees(this)
        @register_attendees = new RegisterAttendees(this)
        @reserve_rooms = new ReserveRooms(this)
        @pay_for_registration = new PayForRegistration(this)
        @guest_list = new GuestList(this)

        # ...and after the class-specific initializers.  Sigh.
        @ready()

    # These methods are required by the parent class
    # Refresh the server state; simply calls the main GET method
    refresh_state: =>
        @get_json 'call/main'

    # The callback for the parent class's get_json and post_json.  Delegates actually updating
    # state to the various subsections.
    refresh_cb: (data) =>
        @select_attendees.server_update data.authorizations
        @register_attendees.server_update data.registrations
        @reserve_rooms.server_update data.reservations
        @pay_for_registration.server_update data.reserved
        @guest_list.server_update data.guest_list

        # Runs once to set default visibility on elements and then display the page
        if not @loaded()
            @select_attendees.try_set_visible(@select_attendees.status() != 'good')
            @register_attendees.try_set_visible(@register_attendees.status() != 'good')
            @reserve_rooms.try_set_visible @reserve_rooms.get_initial_visible()
            @pay_for_registration.try_set_visible(@pay_for_registration.status() != 'good')
            @loaded true


# Next, a series of objects, each backing one of the numbered sections.

# Section 1: getting authorization to see registrations
class SelectAttendees extends FormSection
    constructor: (parent) ->
        # These store the authorizations we want to add and remove
        @pending_additions = ko.observableArray []
        @pending_deletions = ko.observableArray []

        # This observable holds only temporary state; its value is transferred to pending_additions
        # when the user clicks the Add link
        @pending_email = ko.observable()

        # The authorizations as returned by the server, an array of objects with 'email' and
        # 'status' members
        @server_authorizations = []
        @authorizations = ko.computed @get_authorizations

        super parent

    # These methods are required by the parent class
    get_status: =>
        # Unsaved changes live in these two arrays
        if @pending_additions().length or @pending_deletions().length
            @message 'You have unsaved changes.'
            return 'changed'
        # The user cannot proceed unless they are authorized on at least one attendee
        if @server_authorizations.length
            for authorization in @authorizations()
                if authorization.status == 'Active'
                    @message ''
                    return 'good'
        @message 'You have no active registrations.'
        return 'error'

    server_update: (updated) =>
        if not _.isEqual(@server_authorizations, updated)
            @server_authorizations = updated
            @reset()

    # Very simple submit method: send the unsaved changes.
    submit: =>
        message =
            'add': @pending_additions(),
            'remove': @pending_deletions()
        @parent.post_json('call/authorizations', message, @message)

    # Very simple reset method: clear the unsaved changes.
    reset: =>
        @pending_email ''
        @pending_additions []
        @pending_deletions []

    # And, a very simple change summary: just list the unsaved changes.
    get_change_summary: =>
        result = ''
        if @pending_deletions().length
            result += 'Removing reponsibility for the following attendees: '
            result += @pending_deletions().join(', ') + '.  '
        if @pending_additions().length
            result += 'Requesting reponsibility for the following attendees: '
            result += @pending_additions().join(', ') + '.  '
        result

    # Utility methods

    # These two methods are bound to the "Remove" and "Add" links in the table
    # Note the gymnastics that let the user reverse unsaved changes
    remove_authorization: (x) =>
        if @pending_additions.indexOf(x.email) >= 0
            @pending_additions.remove x.email
        else if @pending_deletions.indexOf(x.email) < 0
            @pending_deletions.push x.email

    add_authorization: =>
        if @pending_email()
            if @pending_deletions.indexOf(@pending_email()) >= 0
                @pending_deletions.remove @pending_email()
            else if @pending_additions.indexOf(@pending_email()) < 0
                @pending_additions.push @pending_email()
            @pending_email ''

    # This backs the main section of the table; we have to compute it by taking the server state
    # and applying our unsaved changes.
    get_authorizations: =>
        result = []
        for authorization in @server_authorizations
            if @pending_deletions.indexOf(authorization.email) < 0
                result.push authorization
        for email in @pending_additions()
            result.push email: email, status: 'Not yet saved'
        result


# Section 2: registering people
# Almost all of the work in this class is delegated to the Registration class below
class RegisterAttendees extends FormSection
    constructor: (parent) ->
        @server_regs = []
        @registrations = ko.observableArray []

        super parent

    # These methods are required by the parent class
    get_status: =>
        # Again, most of this just delegates to the child objects
        if not @registrations().length
            @message 'You have no active registrations.'
            return 'disabled'
        for registration in @registrations()
            if registration().status() == 'changed'
                @message 'You have unsaved changes.'
                return 'changed'
        # The user cannot proceed unless they have entered at least one registration
        for registration in @registrations()
            if registration().status() == 'good'
                @message ''
                return 'good'
        @message 'You have not entered any registrations.'
        'error'

    server_update: (updated) =>
        if not _.isEqual(@server_regs, updated)
            @server_regs = updated
            @reset()

    reset: =>
        # This is very slash and burn-- totally recreating the child objects.  But we can only
        # get here in one of two cases:
        #   * The user clicked Reset, in which case they probably want everything to be nuked
        #   * A different user updated one of the registrations.  I expect this to be rare.
        @registrations(ko.observable new Registration(reg, @parent) for reg in @server_regs)

    # A simplistic change summary; it just shows which registrations have changed.  Possibly it
    # should be more detailed.
    get_change_summary: =>
        changed = []
        errors = []
        for reg in @registrations()
            if reg().has_change()
                if reg().has_error()
                    errors.push(reg().email)
                else
                    changed.push(reg().email)

        result = ''
        if changed.length
            result += 'Ready to submit or edit registrations for: ' + changed.join(', ') + '.  '
        if errors.length
            result += 'You must complete registrations for: ' + errors.join(', ') + '.  '
        result

    # We only allow submitting fully legal registrations (but, of course, also check them server
    # side).  However, if a registration hasn't changed at all, we just ignore it.
    get_allow_submit: =>
        not _.some(reg().has_change() and reg().has_error() for reg in @registrations())

    submit: =>
        message = []
        for reg in @registrations()
            if reg().has_change() and not reg().has_error()
                message.push reg().submit_message()

        @parent.post_json('call/register', message, @message)

# This class backs each individual registration; most of the actual work in section 2 happens here.
class Registration
    constructor: (server_reg, main_page) ->
        @server_reg = server_reg
        # This is just a convenience; note it's not observable, because you can't change it
        @email = server_reg.email

        # A ton of observables backing the various sections of the registration form
        @name = ko.observable server_reg.name
        @full_name = ko.observable server_reg.attendee_data?.full_name
        @phone = ko.observable server_reg.attendee_data?.phone

        @nights = {}
        for night in main_page.nights
            @nights[night.id] = ko.observable(new ClickableCell(
                ['no', 'yes'],
                server_reg.nights?[night.id],
                ['no', 'yes'],
                ['reg_no', 'reg_yes']
            ))

        @meals = {}
        for meal in main_page.party_data.meals
            @meals[meal.id] = ko.observable(new ClickableCell(
                ['no', 'maybe', 'yes'],
                server_reg.meals?[meal.id],
                ['no', 'maybe', 'yes'],
                ['reg_no', 'reg_maybe', 'reg_yes']
            ))

        @dietary_restrictions = ko.observable server_reg.attendee_data?.dietary_restrictions
        @medical = ko.observable server_reg.attendee_data?.medical
        @emergency = ko.observable server_reg.attendee_data?.emergency
        @driving = ko.observable server_reg.registration_data?.driving
        @guest_of = ko.observable server_reg.registration_data?.guest_of

        # These (and several other features) mirror features on FormSection; possibly this could
        # be a descendant, although FormSection has a lot of unrelated stuff for submitting
        @message = ko.observable ''
        @status = ko.computed(@get_status).extend(throttle: 50)

    # Reports if the registration is invalid.  Note that not all fields are required.  Keep this
    # in sync with the server-side validation code!
    has_error: =>
        if not @name()?.length
            @message 'Please enter your name for display to others.'
            return true
        if not @full_name()?.length
            @message 'Please enter your full name.'
            return true
        if not @phone()?.length
            @message 'Please enter your phone number.'
            return true
        if not _.some(cell().value() == 'yes' for id, cell of @nights)
            @message 'Please select at least one night.'
            return true
        else if not @emergency()?.length
            @message 'Please provide emergency contact information.'
            return true
        false

    # Reports if the registration has changed.
    has_change: =>
        if not eq(@name(), @server_reg.name)
            return true
        if not eq(@full_name(), @server_reg.attendee_data?.full_name)
            return true
        if not eq(@phone(), @server_reg.attendee_data?.phone)
            return true
        if _.some(cell().changed() for id, cell of @nights)
            return true
        if _.some(cell().changed() for id, cell of @meals)
            return true
        if not eq(@dietary_restrictions(), @server_reg.attendee_data?.dietary_restrictions)
            return true
        if not eq(@medical(), @server_reg.attendee_data?.medical)
            return true
        if not eq(@emergency(), @server_reg.attendee_data?.emergency)
            return true
        if not eq(@driving(), @server_reg.registration_data?.driving)
            return true
        if not eq(@guest_of(), @server_reg.registration_data?.guest_of)
            return true
        false

    # Get the status, again parallel to FormSection
    get_status: =>
        @message ''
        result = 'good'
        if @has_error()
            result = 'error'
        if @has_change()
            result = 'changed'
        result

    # Helper for submit_message
    cell_values: (cells) =>
        result = {}
        for id, cell of cells
            result[id] = cell().value() ? ''
        result

    # Package the contents for submission to the server
    submit_message: =>
        email: @email
        name: @name() ? ''
        nights: @cell_values @nights
        meals: @cell_values @meals
        attendee_data:
            full_name: @full_name() ? ''
            phone: @phone() ? ''
            dietary_restrictions: @dietary_restrictions() ? ''
            medical: @medical() ? ''
            emergency: @emergency() ? ''
        registration_data:
            driving: @driving() ? ''
            guest_of: @guest_of() ? ''


# Section 3: reserving rooms
class ReserveRooms extends FormSection
    constructor: (parent) ->
        # These are just conveniences; we also have access to parent
        @rooms = parent.party_data.rooms
        @nights = parent.nights

        @server_res = {}
        # This is a minor hack to let us update status without making server_res an observable
        @has_active_reg = ko.observable false
        @has_reserved_reg = ko.observable false

        # A map from <night>|<room> ids to ClickableCells (or FixedCells)
        @cells = {}
        for night in @nights
            for id, group of @rooms
                for room in group
                    key = night.id + '|' + room.id
                    @cells[key] = ko.observable new FixedCell('Loading...', 'res_unavailable')
        @status_by_email = ko.observableArray []
        @display_independent = ko.computed(@get_display_independent).extend(throttle: 50)

        # Utility observables for status reporting
        @num_changed_cells = ko.computed(@count_changed_cells).extend(throttle: 50)
        @completed_res = ko.computed(=> @get_changed_res true).extend(throttle: 50)
        @uncompleted_res = ko.computed(=> @get_changed_res false).extend(throttle: 50)

        super parent

    # These methods are required by the parent class
    get_status: =>
        if not @parent.party_data.reservations_enabled
            @message 'Room reservations are not yet open.'
            return 'error'
        if not @has_active_reg()
            @message 'You have not entered any registrations.'
            return 'error'
        if @num_changed_cells() or @completed_res().length or @uncompleted_res().length
            @message 'You have unsaved changes.'
            return 'changed'
        if @has_reserved_reg()
            @message ''
            return 'good'
        @message 'You have not reserved rooms for any registrations.'
        'error'

    # A relatively simplistic change summary, but there's not much complexity to be had
    get_change_summary: =>
        result = ''
        changed_cells = @num_changed_cells()
        if changed_cells
            result += 'Changing ' + changed_cells + ' room(s).  '
        completed_res = @completed_res()
        if completed_res.length
            result += 'Completing registrations for: ' + completed_res.join(', ') + '.  '
        uncompleted_res = @uncompleted_res()
        if uncompleted_res.length
            result += 'Un-completing registrations for: ' + uncompleted_res.join(', ') +
                '.  Do you really mean to do that?'
        result

    # Submits the reservations requested, as well as the registrations to mark complete.  We trust
    # the user to mark registrations complete, since they can theoretically do so without reserving
    # anything
    submit: =>
        reservations = {}
        for key, cell of @cells
            if cell().changed?()
                reservations[key] = cell().value()
        message =
            reservations: reservations
            complete: @completed_res()
            uncomplete: @uncompleted_res()

        @parent.post_json('call/reserve', message, @message)

    server_update: (updated) =>
        if not _.isEqual(@server_res, updated)
            @server_res = updated
            @reset()

    # This is pretty slash-and-burn; we regenerate all the cells.  I decided not to try to figure
    # out partial overwriting in the case where our request didn't go through.  Oh well.
    reset: =>
        # These are not computed observables; it's probably simpler this way.
        @has_active_reg(@server_res.active_reg.length > 0)
        @has_reserved_reg _.some(reg.reserved for reg in @server_res.active_reg)

        # The map of existing reservations typically contains only rooms with any reservation, so
        # we have to iterate over nights and rooms to construct the table
        for night in @nights
            # Some arguments for the ClickableCell are fixed across rooms
            options = [null]
            labels = ['']
            for reg in @server_res.active_reg
                if night.id in reg.nights
                    options.push(reg.email)
                    labels.push(reg.name)

            for id, group of @rooms
                for room in group
                    key = night.id + '|' + room.id
                    # FixedCells for rooms we can't reserve.  There are three cases.
                    # 1. Nobody can reserve anything;
                    if not @parent.party_data.reservations_enabled or
                            # 2. Someone has reserved the room;
                            key of @server_res.unauthorized or
                            # 3. We have no registrations ready to reserve yet.
                            options.length < 2
                        existing = @server_res.unauthorized[key]
                        if existing
                            style = 'res_taken'
                        else
                            style = 'res_unavailable'
                        @cells[key] new FixedCell(existing, style)
                    else
                        # We have to iterate through all the options to construct the style list
                        # (see TODO above; I want to replace this with a list of objects)
                        styles = []
                        existing = @server_res.authorized[key]
                        for option in options
                            if eq(option, existing)
                                if option
                                    style = 'res_reserved'
                                else
                                    style = 'res_available'
                            else
                                style = 'res_changed'
                            styles.push style
                        @cells[key] new ClickableCell(options, existing, labels, styles)

        # Finally, reset the status entries at the bottom
        @status_by_email (new RegStatusEntry(reg, this) for reg in @server_res.active_reg)

    # Utility methods
    count_changed_cells: =>
        result = 0
        for key, cell of @cells
            if cell().changed?()
                result += 1
        return result

    # This is bound to computed observables above; it's kind of like functional programming, right?
    get_changed_res: (complete) =>
        result = []
        for status in @status_by_email()
            # The second part of this is an evil hack to get bool coercion
            if status.get_changed() and (not complete) == (not status.reservation_complete())
                result.push status.reg.email
        result

    # If any registration has unreserved nights, display this fact and ask for confirmation
    get_display_independent: =>
        for status in @status_by_email()
            if status.unreserved_nights().length
                return true
        false

    # The section is visible if at least one of the active registrations has not reserved rooms
    get_initial_visible: =>
        not _.every(reg.reserved for reg in @server_res.active_reg)

# A simple utility class to help display the status of registrations
class RegStatusEntry
    constructor: (reg, parent) ->
        # This is the ReserveRooms object, not the MainPageModel
        @parent = parent
        @reg = reg
        @confirmed = ko.observable reg.reserved
        @unreserved_nights = ko.computed(@get_unreserved_nights).extend(throttle: 50)
        @reservation_complete = ko.computed @get_reservation_complete

    # Note that this goes by the completion state; thus if the confirmation checkbox changes and is
    # then hidden due to the reservation being completed by rooms being selected, the hidden state
    # does not affect the result
    get_changed: =>
        @reservation_complete() != @reg.reserved

    get_reservation_complete: =>
        @confirmed() or not @unreserved_nights().length

    # Finds the nights that are unreserved.  Uses the straightforward (if possibly expensive)
    # approach of iterating over all of the cells; there shouldn't be many registrations.
    get_unreserved_nights: =>
        result = []
        for night in @parent.nights
            if night.id not in @reg.nights
                continue
            registered = false
            for id, group of @parent.rooms
                for room in group
                    if eq(@parent.cells[night.id + '|' + room.id]().value?(), @reg.email)
                        registered = true
            if not registered
                result.push night.name
        result


# Section 4: recording subsidy and financial aid choices, and displaying payment due
class PayForRegistration extends FormSection
    constructor: (parent) ->
        @server_status = {}
        @sections = ko.observableArray []
        @total_due = ko.computed @get_total_due
        # This is used to determine whether to display payment / refund information or a thank-you
        @display_section = ko.computed @get_display_section

        super parent

    # These methods are required by the parent class
    server_update: (updated) =>
        if not _.isEqual(@server_status, updated)
            @server_status = updated
            @reset()

    reset: =>
        @sections (new PaymentSection(status) for status in @server_status)

    get_change_summary: =>
        emails = []
        for sec in @sections()
            if sec.has_change()
                emails.push sec.srv_data.email
        'Changed options for: ' + emails.join(', ')

    submit: =>
        message = []
        for sec in @sections()
            if sec.has_change()
                message.push sec.submit_message()

        @parent.post_json('call/financial', message, @message)

    # The status for the main section keys off of the text displayed, which in turn depends on the
    # total due, not the status for individual sections.  I think that's right.
    get_status: =>
        if not @sections().length
            @message 'You have not completed any registrations.'
            return 'disabled'
        if @has_change()
            @message 'You have unsaved changes.'
            return 'changed'
        switch @display_section()
            when 'due'
                @message 'One or more registrations has not been paid for.'
                return 'error'
            when 'excess'
                @message 'You seem to have overpaid for your registrations.'
                return 'error'
        @message ''
        return 'good'

    # Utility methods
    has_change: =>
        for sec in @sections()
            if sec.has_change()
                return true
        false

    get_total_due: =>
        result = 0
        for sec in @sections()
            result += sec.srv_data.due
        result

    # The use of ">= 0.01" in the below methods guards against floating-point errors
    get_display_section: =>
        if @has_change()
            return ''
        if @total_due() >= 0.01
            return 'due'
        if @total_due() <= -0.01
            return 'excess'
        return 'zero'

    # These are used in the HTML for formatting
    total_label: (due) =>
        if due >= 0.01
            return 'Amount Due'
        if due <= -0.01
            return 'Excess Paid'
        ''

    total_style: (due) =>
        if due >= 0.01
            return 'pmt_due'
        if due <= -0.01
            return 'pmt_excess'
        return 'pmt_zero'

class PaymentSection
    constructor: (srv_data) ->
        @srv_data = srv_data

        # These are stored on the server as a single amount: negative for requesting, positive for
        # contributing
        [transport_choice, transport_value] = @parse_amt srv_data.financial_data.transport_amount
        @transport_choice = ko.observable transport_choice
        @transport_value = ko.observable transport_value

        [assistance_choice, assistance_value] = @parse_amt srv_data.financial_data.assistance_amount
        @assistance_choice = ko.observable assistance_choice
        @assistance_value = ko.observable assistance_value

        @assistance_pledge = ko.observable srv_data.financial_data.assistance_pledge

        @transport_amt = ko.computed @get_transport_amt
        @assistance_amt = ko.computed @get_assistance_amt
        @status = ko.computed @get_status

    parse_amt: (amt) =>
        if not amt?
            return [null, null]
        if amt == 0.0
            return ['none', 0.0]
        if amt > 0.0
            return ['contributing', amt]
        return ['requesting', -amt]

    get_amt: (choice, value) =>
        if choice == 'none'
            return 0.0
        if not valid_float(value)
            return null
        result = parseFloat(value)
        if choice == 'requesting'
            result = -result
        result

    get_transport_amt: =>
        @get_amt(@transport_choice(), @transport_value())

    get_assistance_amt: =>
        @get_amt(@assistance_choice(), @assistance_value())

    # Reports if the inputs have changed.
    has_change: =>
        if not eq_strict(@transport_amt(), @srv_data.financial_data?.transport_amount)
            return true
        if not eq_strict(@assistance_amt(), @srv_data.financial_data?.assistance_amount)
            return true
        if not eq(@assistance_pledge(), @srv_data.financial_data?.assistance_pledge)
            return true
        false

    get_status: =>
        if @has_change()
            return 'changed'
        if @srv_data.due >= 0.01 or @srv_data.due <= -0.01
            return 'error'
        'good'

    submit_message: =>
        email: @srv_data.email
        financial_data:
            transport_amount: @transport_amt()
            assistance_amount: @assistance_amt()
            assistance_pledge: @assistance_pledge()


# Section 5: the guest list
# This section is not interactive, but is backed by a class to hold the server data and provide
# a utility method
class GuestList extends FormSection
    constructor: (parent) ->
        @guests = ko.observableArray []

        super parent

    server_update: (updated) =>
        @guests updated

    # We have data for nights, but want to display days; hence we care about index - 1 (last night)
    # and index (tonight).
    class_for_cell: (index, nights) =>
        last_cell = false
        if index > 0
            last_cell = @parent.party_data.days[index - 1].id in nights
        this_cell = @parent.party_data.days[index].id in nights
        if last_cell
            if this_cell
                return 'guest_center'
            return 'guest_right'
        if this_cell
            return 'guest_left'
        return 'guest_none'


# Bind the model
$(document).ready =>
    ko.applyBindings new MainPageModel()
