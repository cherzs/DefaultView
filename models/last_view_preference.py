from odoo import models, fields, api, _
import logging
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)

class LastViewPreference(models.Model):
    _name = 'last.view.preference'
    _description = 'Last View Preference'
    _order = 'write_date desc'
    
    user_name = fields.Char(related='user_id.name', store=True)
    model_name = fields.Char(string='Model Name', required=True, index=True)
    view_type = fields.Selection([
        ('list', 'List'),
        ('kanban', 'Kanban'),
        ('form', 'Form'),
        ('calendar', 'Calendar'),
        ('pivot', 'Pivot'),
        ('graph', 'Graph'),
        ('activity', 'Activity'),
        ('map', 'Map'),
        ('gantt', 'Gantt'),
        ('diagram', 'Diagram'),
        ('dashboard', 'Dashboard'),
    ], string='View Type', required=True)
    active = fields.Boolean('Active', default=True, index=True)
    action_id = fields.Integer('Action ID', required=True)
    action_name = fields.Char('Action Name', help="Name of the action/menu")
    user_id = fields.Many2one('res.users', 'User', required=True, default=lambda self: self.env.user)

    _sql_constraints = [
        ('unique_preference', 
         'unique(model_name,user_id,action_id)', 
         'View preference must be unique per model, user and action!')
    ]

    @api.model
    def get_last_view_for_model(self, model_name):
        """Retrieve last view preference for the given model."""
        if not model_name:
            raise ValidationError(_("Model name is required."))
        preference = self.search([('user_id', '=', self.env.uid), ('model_name', '=', model_name)], limit=1)
        return {
            'view_type': preference.view_type if preference else False,
        }

    @api.model
    def save_last_view(self, model, view_type, action_id, action_name=False):
        """
        Save last view preference
        :param model: string, model name
        :param view_type: string, view type (list, form, kanban, etc)
        :param action_id: integer, action ID
        :param action_name: string, action name/menu name
        :return: boolean
        """
        _logger.info("[ViewPreference] Saving preference: model=%s, view=%s, action=%s, name=%s", 
                     model, view_type, action_id, action_name)
        
        try:
            # Search existing preference
            domain = [
                ('model_name', '=', model),
                ('user_id', '=', self.env.user.id),
                ('action_id', '=', action_id)
            ]
            
            values = {
                'model_name': model,
                'view_type': view_type,
                'action_id': action_id,
                'action_name': action_name,
                'user_id': self.env.user.id,
                'active': True
            }

            existing = self.search(domain, limit=1)
            if existing:
                _logger.info("[ViewPreference] Updating existing record: %s", existing.id)
                existing.write(values)
            else:
                _logger.info("[ViewPreference] Creating new record")
                self.create(values)

            return True

        except Exception as e:
            _logger.error("[ViewPreference] Error: %s", str(e))
            return False