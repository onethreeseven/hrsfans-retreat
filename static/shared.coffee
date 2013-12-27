class PageModel
    constructor: ->
        @loaded = ko.observable false
        @visible_section = ko.observable null
        $.ajax(url: 'call/init', success: @init_cb, async: false)

    init_cb: (data) =>
        document.title = data.party_name
        @party_data = data.party_data
        @logout_url = data.logout_url
        @user_nickname = data.user_nickname
        @is_admin = data.is_admin
        @nights = @party_data.days[...-1]

    get_json: (url) =>
        $.get(url, @refresh_cb)

    post_json: (url, message, error_cb) =>
        cb = (data) =>
            @refresh_cb data
            if data.error?.length
                error_cb data.error
        $.post(url, {message: JSON.stringify(message)}, cb)

    # This is totally not core engineering, but is in fact needed by both main and admin, so shrug
    compute_financials: (data) ->
        result = {}

        # Pull data from the registrations
        for email, reg of data.registrations
            if reg.confirmed
                item =
                    adjustment: reg.adjustment ? 0.0
                    aid: reg.aid ? 0.0
                    aid_pledge: 0.0
                    credits: []
                    expenses: []
                    meals: 0
                    name: reg.name
                    rooms: 0
                    subsidy: reg.subsidy ? 0.0
                if reg.aid_pledge? and item.aid > 0.0
                    item.aid_pledge = reg.aid_pledge
                for meal in @party_data.meals
                    if reg.meals[meal.id] == 'yes'
                        item.meals += meal.cost
                result[email] = item

        # Pull data from the reservations
        for night in @nights
            for id, group of @party_data.rooms
                for room in group
                    for bed in room.beds
                        key = night.id + '|' + bed.id
                        if key of data.reservations
                            email = data.reservations[key].registration
                            if email of result
                                result[email].rooms += bed.costs[night.id]

        # Pull data from the credits
        for credit in data.credits
            email = credit.registration
            if email of result
                result[email].credits.push(date: credit.date, amount: credit.amount)

        # Pull data from the expenses
        for id, expense of data.expenses
            email = expense.registration
            if email of result
                result[email].expenses.push(date: expense.date, amount: expense.amount)

        # Sum it up for convenience
        for email, item of result
            item.due = item.adjustment + item.aid + item.meals + item.rooms + item.subsidy
            for credit in item.credits
                item.due -= credit.amount
            for expense in item.expenses
                item.due -= expense.amount

        result


class FormSection
    constructor: (parent) ->
        @parent = parent
        # This gets set by @get_status, so be sure to create it first
        @message = ko.observable()
        @status = ko.computed @get_status
        @status_for_selector = ko.computed @get_status_for_selector
        @change_summary = ko.computed(@get_change_summary).extend(throttle: 25)
        @allow_submit = ko.computed(@get_allow_submit).extend(throttle: 25)

    try_set_visible: =>
        if @parent.visible_section()?.status() != 'changed' and @status() != 'disabled'
            @parent.visible_section this

    get_status: =>
        @message ''
        'header'

    get_status_for_selector: =>
        result = @status()
        if @parent.visible_section() == this
            result += ' section_selected'
        if @parent.visible_section()?.status() != 'changed' and @status() != 'disabled'
            result += ' pointer'
        result

    get_change_summary: =>
        'Unknown.'

    get_allow_submit: =>
        true

_.mixin dollar_val: (x, precision = 0) ->
    if x?
        val = '$' + Math.abs(x).toFixed(precision)
        if x < 0
            val = '(' + val + ')'
        return val
    ''

window.registry ?= {}
window.registry.PageModel = PageModel
window.registry.FormSection = FormSection
