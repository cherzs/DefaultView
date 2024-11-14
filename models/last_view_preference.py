from odoo import models, fields, api
from datetime import datetime
import logging

_logger = logging.getLogger(__name__)

class LastViewPreference(models.Model):
    _name = 'last.view.preference'
    _description = 'Last View Preference'
    _order = 'write_date desc'
    
    user_id = fields.Many2one('res.users', string='User', required=True, default=lambda self: self.env.user)
    model_name = fields.Char(string='Technical Name', required=True)
    model_description = fields.Char(string='Module', compute='_compute_model_description', store=True)
    view_type = fields.Selection([
        ('list', 'List'),
        ('kanban', 'Kanban'),
        ('form', 'Form'),
        ('calendar', 'Calendar'),
        ('pivot', 'Pivot'),
        ('graph', 'Graph'),
    ], string='View Type', required=True)
    create_date = fields.Datetime('Created On', readonly=True)
    write_date = fields.Datetime('Last Modified', readonly=True)
    last_accessed = fields.Datetime('Last Accessed', default=fields.Datetime.now)

    _sql_constraints = [
        ('unique_user_model', 'unique(user_id, model_name)', 'Only one preference per user per model is allowed!')
    ]

    @api.depends('model_name')
    def _compute_model_description(self):
        for record in self:
            if record.model_name:
                model = self.env['ir.model'].sudo().search([('model', '=', record.model_name)], limit=1)
                record.model_description = model.name if model else record.model_name
            else:
                record.model_description = False

    def action_clear_preference(self):
        self.ensure_one()
        self.unlink()
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Success',
                'message': f'View preference cleared for {self.model_description}',
                'type': 'success',
                'sticky': False,
            }
        }

    def write(self, vals):
        if not vals.get('last_accessed'):
            vals['last_accessed'] = fields.Datetime.now()
        return super().write(vals)

    @api.model
    def create(self, vals):
        if not vals.get('last_accessed'):
            vals['last_accessed'] = fields.Datetime.now()
        return super().create(vals)

    @api.model
    def get_last_view_for_model(self, model_name):
        """Get the last view preference for a specific model"""
        if not model_name:
            return False

        preference = self.search([
            ('user_id', '=', self.env.uid),
            ('model_name', '=', model_name)
        ], order='write_date desc', limit=1)

        if preference:
            return {
                'view_type': preference.view_type,
                'model_name': preference.model_name,
                'model_description': preference.model_description
            }
        return False

    @api.model
    def save_last_view(self, model_name, view_type):
        """Save or update view preference"""
        if not model_name or not view_type:
            return False

        try:
            preference = self.search([
                ('user_id', '=', self.env.uid),
                ('model_name', '=', model_name)
            ], limit=1)

            vals = {
                'user_id': self.env.uid,
                'model_name': model_name,
                'view_type': view_type,
                'last_accessed': fields.Datetime.now()
            }

            if preference:
                preference.write(vals)
            else:
                self.create(vals)
            return True

        except Exception as e:
            _logger.error(f"Error saving view preference: {str(e)}")
            return False

class ResUsers(models.Model):
    _inherit = 'res.users'

    def set_last_view(self, model_name, view_type):
        _logger.info(f'Setting last view for user {self.name} ({self.id}): {model_name} - {view_type}')
        
        # Menggunakan search dan write/create alih-alih SQL mentah
        view_preference = self.env['last.view.preference'].search([
            ('user_id', '=', self.id),
            ('model_name', '=', model_name)
        ], limit=1)

        if view_preference:
            # Jika preferensi sudah ada, lakukan update
            view_preference.write({'view_type': view_type})
        else:
            # Jika preferensi belum ada, lakukan create
            self.env['last.view.preference'].create({
                'user_id': self.id,
                'model_name': model_name,
                'view_type': view_type
            })
        
        _logger.info(f'View preference saved for {model_name}: {view_type}')
        return True

    def get_last_view(self, model_name):
        _logger.info(f'Getting last view for user {self.name} ({self.id}): {model_name}')
        
        # Menggunakan pencarian ORM untuk mendapatkan preferensi terakhir
        view_preference = self.env['last.view.preference'].search([
            ('user_id', '=', self.id),
            ('model_name', '=', model_name)
        ], order="write_date desc", limit=1)
        
        if view_preference:
            view_type = view_preference.view_type
            _logger.info(f'Found view preference: {view_type}')
            return view_type
        
        _logger.info('No view preference found')
        return False
