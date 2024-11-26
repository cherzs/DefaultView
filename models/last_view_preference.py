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
    action_id = fields.Many2one('ir.actions.act_window', string="Action")
    action_name = fields.Char(related='action_id.name', string="Action Name", store=True)

    _sql_constraints = [
        ('unique_active_preference_action',
         'UNIQUE(user_id, action_id, active)',
         'Only one active preference per user per action is allowed!')
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
    def save_last_view(self, model_name, view_type, action_id=False):
        """Save or update last view preference."""
        if not model_name or not view_type or not action_id:
            raise ValidationError(_("Model name, view type, and action ID are required."))
        
        _logger.info(f"Saving view preference: user={self.env.uid}, model={model_name}, view={view_type}, action={action_id}")
        
        # Find existing preference for this action
        existing = self.search([
            ('user_id', '=', self.env.uid),
            ('action_id', '=', action_id),
            ('active', '=', True)
        ], limit=1)
        
        if existing:
            # Update existing preference
            existing.write({
                'view_type': view_type,
                'write_date': fields.Datetime.now()
            })
            _logger.info(f"Updated existing preference ID {existing.id}")
        else:
            # Deactivate old preferences for this model/action combination
            old_preferences = self.search([
                ('user_id', '=', self.env.uid),
                ('model_name', '=', model_name),
                ('action_id', '=', action_id),
                ('active', '=', True)
            ])
            if old_preferences:
                old_preferences.write({'active': False})
            
            # Create new preference
            self.create({
                'user_id': self.env.uid,
                'model_name': model_name,
                'view_type': view_type,
                'action_id': action_id,
                'active': True
            })
            _logger.info(f"Created new preference for {model_name}")
        
        # Commit the transaction
        self.env.cr.commit()
        return True

    @api.model_create_multi
    def create(self, vals_list):
        """Override create to ensure only one active preference per action."""
        for vals in vals_list:
            if vals.get('active') and vals.get('action_id'):
                # Deactivate existing preferences for this action
                old_preferences = self.search([
                    ('user_id', '=', vals.get('user_id', self.env.uid)),
                    ('action_id', '=', vals['action_id']),
                    ('active', '=', True)
                ])
                if old_preferences:
                    old_preferences.write({'active': False})
        
        return super().create(vals_list)

    def write(self, vals):
        """Override write to ensure only one active preference per action."""
        if vals.get('active') and vals.get('action_id'):
            # Deactivate existing preferences for this action
            old_preferences = self.search([
                ('user_id', '=', self.user_id.id),
                ('action_id', '=', vals['action_id']),
                ('id', '!=', self.id),
                ('active', '=', True)
            ])
            if old_preferences:
                old_preferences.write({'active': False})
        
        return super().write(vals)

    def clean_old_preferences(self):
        """Cleanup method to remove duplicate preferences."""
        self.env.cr.execute("""
            WITH latest_preferences AS (
                SELECT DISTINCT ON (user_id, action_id) 
                    id,
                    user_id,
                    action_id
                FROM last_view_preference
                WHERE active = true
                ORDER BY user_id, action_id, write_date DESC
            )
            UPDATE last_view_preference
            SET active = false
            WHERE active = true 
            AND id NOT IN (SELECT id FROM latest_preferences)
        """)
        self.env.cr.commit()