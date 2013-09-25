class PageModel
    constructor: ->
        $.ajax(url: 'call/init', success: @init_cb, async: false)
        @loaded = ko.observable false
        @show_only_section = ko.observable null

    init_cb: (data) =>
        document.title = data.party_name
        @party_data = data.party_data
        @logout_url = data.logout_url
        @user_nickname = data.user_nickname
        @nights = @party_data.days?[...-1]

    # Subclasses will generally want to call part of this class's setup at the top of their
    # constructor and part at the bottom; hence this awkward extra function.
    ready: =>
        @refresh_state()

    get_json: (url) =>
        $.get(url, @refresh_cb)

    post_json: (url, message, error_cb) =>
        cb = (data) =>
            error_cb data.error
            @refresh_cb data
        $.post(url, {message: JSON.stringify(message)}, cb)


class FormSection
    constructor: (parent) ->
        @parent = parent
        @visible = ko.observable true
        # This gets set by @get_status, so be sure to create it first
        @message = ko.observable()
        @status = ko.computed =>
            result = @get_status()
            @try_set_visible(null, result)
            result
        @hide_toggle_text = ko.computed =>
            if @visible()
                return 'Hide'
            'Show'
        @change_summary = ko.computed(@get_change_summary).extend(throttle: 50)
        @allow_submit = ko.computed(@get_allow_submit).extend(throttle: 50)
        @can_set_visible = ko.computed @get_can_set_visible
        @show_entire = ko.computed @get_show_entire
        @show_entire_toggle_text = ko.computed =>
            if @showing_only()
                return 'Show other sections'
            return 'Hide other sections'

    try_set_visible: (x, status) =>
        if @showing_only()
            @visible true
            return
        status ?= @status()
        switch status
            when 'disabled'
                @visible false
            when 'changed'
                @visible true
            else
                if x?
                    @visible x

    toggle_visible: =>
        @try_set_visible not @visible()

    get_status: =>
        @message ''
        'good'

    get_change_summary: =>
        'Unknown.'

    get_allow_submit: =>
        true

    get_can_set_visible: =>
        if @showing_only()
            return false
        switch @status()
            when 'disabled', 'changed'
                return false
            else
                true

    showing_only: =>
        @parent.show_only_section() == this

    get_show_entire: =>
        not @parent.show_only_section()? or @showing_only()

    toggle_show_only: =>
        if @parent.show_only_section()?
            @parent.show_only_section null
        else
            @parent.show_only_section this
        @try_set_visible null

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
