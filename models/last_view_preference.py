from odoo import models, fields, api
import logging
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)

class LastViewPreference(models.Model):
    _name = 'last.view.preference'
    _description = 'Last View Preference'
    _order = 'write_date desc'
    
    user_id = fields.Many2one('res.users', string='User', required=True, 
                             default=lambda self: self.env.user)
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

    _sql_constraints = [
        ('unique_user_model_active', 
         'unique(user_id, model_name, active)',
         'Only one active preference per user per model is allowed!')
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
    def save_last_view(self, model_name, view_type):
        """Save or update last view preference."""
        if not model_name or not view_type:
            raise ValidationError(_("Both model name and view type are required."))
        
        _logger.debug(f"Saving view preference: user={self.env.uid}, model={model_name}, view={view_type}")
        
        preference = self.search([('user_id', '=', self.env.uid), ('model_name', '=', model_name)], limit=1)
        if preference:
            preference.view_type = view_type
        else:
            self.create({
                'user_id': self.env.uid,
                'model_name': model_name,
                'view_type': view_type,
            })
        return True