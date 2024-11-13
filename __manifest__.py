{
    'name': 'Last View Preference',
    'version': '1.0',
    'category': 'Tools',
    'summary': 'Save and restore last view preference per user',
    'depends': ['base', 'web'],
    'data': [
        'security/ir.model.access.csv',
        'views/last_view_preference_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'DefaultView/static/src/js/last_view_preference.js',
            'DefaultView/static/src/xml/last_view_preference.xml',
        ],
    },
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
} 