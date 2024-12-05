{
    'name': 'Last View Preference',
    'version': '1.0',
    'category': 'Tools',
    'summary': 'Save and restore last view preference per user',
    'depends': ['base', 'web'],
    'sequence': -100,
    'data': [
        'security/ir.model.access.csv',
        'views/last_view_preference_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'DefaultView/static/src/js/last_view_preference.js',
            'DefaultView/static/src/js/last_view_preference_loader.js',
            'DefaultView/static/src/xml/last_view_preference.xml',
            'DefaultView/static/src/actions/action_container.js',
        ],
    },
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
} 