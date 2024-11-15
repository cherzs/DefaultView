from odoo import models, fields, api
import logging

_logger = logging.getLogger(__name__)

class LastViewPreference(models.Model):
    _name = 'last.view.preference'
    _description = 'Last View Preference'

    user_id = fields.Many2one('res.users', string='User', required=True, default=lambda self: self.env.user)
    model_name = fields.Char('Model Name', required=True)
    view_type = fields.Selection([
        ('list', 'List'),
        ('kanban', 'Kanban'),
        ('form', 'Form'),
        ('calendar', 'Calendar'),
        ('pivot', 'Pivot'),
        ('graph', 'Graph')
    ], string='View Type', required=True)

    _sql_constraints = [
        ('unique_user_model', 'unique(user_id, model_name)', 'Only one preference per user per model!')
    ]

    def init(self):
        """Create index for faster lookups"""
        super(LastViewPreference, self).init()
        self._cr.execute("""
            CREATE INDEX IF NOT EXISTS last_view_preference_user_model_idx 
            ON last_view_preference (user_id, model_name)
        """)

    @api.model
    def get_preferences(self):
        """Get all preferences for current user"""
        _logger.info('get_preferences called for user %s', self.env.user.id)
        try:
            # Use search_read for better performance
            preferences = self.sudo().search_read(
                [('user_id', '=', self.env.user.id)],
                ['model_name', 'view_type']
            )
            
            # Convert to expected format
            result = {
                pref['model_name']: pref['view_type'] 
                for pref in preferences
            }
            
            _logger.info('Found preferences: %s', result)
            return result

        except Exception as e:
            _logger.error('Error in get_preferences: %s', str(e))
            return {}

    @api.model
    def save_last_view(self, *args):
        """Save view preference for current user"""
        try:
            # Validasi input
            if not args or len(args) < 2:
                _logger.error('Invalid arguments received: %s', args)
                return False
            
            model_name, view_type = args[0], args[1]
            
            # Validasi model_name
            if not model_name or not self.env['ir.model'].sudo().search([('model', '=', model_name)]):
                _logger.error('Invalid model name: %s', model_name)
                return False
            
            # Validasi view_type
            valid_view_types = ['list', 'kanban', 'form', 'calendar', 'pivot', 'graph']
            if view_type not in valid_view_types:
                _logger.error('Invalid view type: %s', view_type)
                return False

            # Log current user
            _logger.info('Saving preference for user ID: %s', self.env.user.id)

            # Find existing preference
            domain = [
                ('user_id', '=', self.env.user.id),
                ('model_name', '=', model_name)
            ]
            
            values = {
                'user_id': self.env.user.id,
                'model_name': model_name,
                'view_type': view_type
            }

            # Log the search
            preference = self.sudo().search(domain, limit=1)
            if preference:
                _logger.info('Updating existing preference ID: %s', preference.id)
                preference.write(values)
            else:
                _logger.info('Creating new preference')
                self.sudo().create(values)

            _logger.info('Successfully saved preference: %s -> %s', model_name, view_type)
            return True

        except Exception as e:
            _logger.error('Error in save_last_view: %s', str(e))
            return False

    @api.model
    def get_last_view_for_model(self, model_name):
        """Get last view preference for specific model"""
        _logger.info('get_last_view_for_model called for %s', model_name)
        try:
            if not model_name:
                return False

            preference = self.sudo().search_read(
                [
                    ('user_id', '=', self.env.user.id),
                    ('model_name', '=', model_name)
                ],
                ['view_type'],
                limit=1
            )

            if preference:
                _logger.info('Found preference for %s: %s', 
                            model_name, preference[0]['view_type'])
                return {
                    'view_type': preference[0]['view_type'],
                    'model_name': model_name
                }
            
            _logger.info('No preference found for %s', model_name)
            return False

        except Exception as e:
            _logger.error('Error in get_last_view_for_model: %s', str(e))
            return False
