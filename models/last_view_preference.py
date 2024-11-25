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
        ('unique_user_model_active_mode', 
         'unique(user_id, model_name, active, view_mode)',
         'Only one active preference per user per model per mode is allowed!')
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
        
        # Cek apakah sudah ada preference untuk model ini (aktif atau tidak)
        existing_preference = self.search([
            ('user_id', '=', self.env.uid),
            ('model_name', '=', model_name),
        ], limit=1)
        
        # Jika sudah ada preference untuk model ini
        if existing_preference:
            # Jika view_type sama, tidak perlu melakukan apa-apa
            if existing_preference.view_type == view_type:
                return True
                
            # Jika view_type berbeda, update preference yang ada
            existing_preference.write({
                'view_type': view_type,
                'active': True
            })
            return True
            
        # Jika belum ada preference untuk model ini, buat baru
        action = self.env['ir.actions.act_window'].search([
            ('res_model', '=', model_name),
            ('view_mode', 'like', view_type)
        ], limit=1)
        
        self.create({
            'user_id': self.env.uid,
            'model_name': model_name,
            'view_type': view_type,
            'action_id': action.id if action else False,
            'active': True
        })
        
        return True

    @api.model_create_multi
    def create(self, vals_list):
        """Override create to ensure action_id is set."""
        for vals in vals_list:
            if 'model_name' in vals and not vals.get('action_id'):
                action = self.env['ir.actions.act_window'].search([
                    ('res_model', '=', vals['model_name'])
                ], limit=1)
                if action:
                    vals['action_id'] = action.id
        return super().create(vals_list)

    def write(self, vals):
        """Override write to ensure action_id is set."""
        if 'model_name' in vals:
            action = self.env['ir.actions.act_window'].search([
                ('res_model', '=', vals['model_name'])
            ], limit=1)
            if action:
                vals['action_id'] = action.id
        return super().write(vals)