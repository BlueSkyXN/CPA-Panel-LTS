"""Keep existing single-workspace smokes scoped to the active Panel runtime.

Browser events, screenshots, network interception and navigation remain on the
real Page. DOM operations address its active same-origin instance document.
Connection-manager tests deliberately use the raw Page instead.
"""

class PanelBrowser:
    DOM_METHODS = {
        'locator', 'get_by_role', 'get_by_text', 'get_by_label', 'get_by_title',
        'get_by_placeholder', 'get_by_test_id', 'get_by_alt_text', 'evaluate',
        'evaluate_handle', 'wait_for_function', 'wait_for_selector', 'content',
        'query_selector', 'query_selector_all', 'click', 'fill', 'press',
    }

    def __init__(self, page):
        self.raw = page

    def _scope(self):
        element = self.raw.locator('iframe[data-active=true]')
        return element.element_handle().content_frame() if element.count() else self.raw

    def _ready(self):
        self.raw.wait_for_selector('iframe[data-active=true], input[name="cpa-management-key"]', state='attached')
        scope = self._scope()
        if scope != self.raw:
            scope.wait_for_selector('.app-shell', state='attached', timeout=30000)

    def goto(self, *args, **kwargs):
        result = self.raw.goto(*args, **kwargs)
        self._ready()
        return result

    def reload(self, *args, **kwargs):
        result = self.raw.reload(*args, **kwargs)
        self._ready()
        return result

    def wait_for_url(self, *args, **kwargs):
        result = self.raw.wait_for_url(*args, **kwargs)
        if not self.raw.url.endswith('/login'):
            self.raw.wait_for_selector('iframe[data-active=true]', state='attached')
            self._ready()
            self.raw.locator('iframe[data-active=true]').focus()
        return result

    def reconnect(self):
        self.raw.get_by_role('button', name='Switch instance', exact=True).click()
        self.raw.get_by_role('dialog').locator('button[aria-current=true]').click()
        self.raw.wait_for_selector('iframe[data-active=true]', state='attached')
        self._ready()

    def __getattr__(self, name):
        if name == 'locator' or name.startswith('get_by_'):
            def locate(*args, **kwargs):
                scope = self.raw.frame_locator('iframe[data-active=true]') if self.raw.locator('iframe[data-active=true]').count() else self.raw
                return getattr(scope, name)(*args, **kwargs)
            return locate
        if name in self.DOM_METHODS:
            return lambda *args, **kwargs: getattr(self._scope(), name)(*args, **kwargs)
        return getattr(self.raw, name)
