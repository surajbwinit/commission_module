using System.Text.Json;
using Commission.Api.Data;
using Microsoft.AspNetCore.Mvc;

namespace Commission.Api.Controllers;

[ApiController]
[Route("api/kpis")]
public class KpisController : ControllerBase
{
    private static readonly HashSet<string> ValidFormulaTypes = new() { "simple", "ratio", "growth", "team", "static" };
    private readonly IDb _db;
    public KpisController(IDb db) { _db = db; }

    private static bool ValidateFormula(string? formulaStr)
    {
        if (string.IsNullOrWhiteSpace(formulaStr)) return true;
        try
        {
            var doc = JsonDocument.Parse(formulaStr);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            if (!doc.RootElement.TryGetProperty("type", out var t)) return false;
            return ValidFormulaTypes.Contains(t.GetString() ?? "");
        }
        catch { return true; }   // legacy text formulas allowed
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? category)
    {
        var sql = "SELECT * FROM kpi_definitions WHERE is_active = 1" +
                  (category != null ? " AND category = @cat" : "") +
                  " ORDER BY category, name";
        var rows = await _db.QueryDynamicAsync(sql, new { cat = category });
        return Ok(rows);
    }

    [HttpGet("categories")]
    public async Task<IActionResult> Categories()
    {
        var rows = await _db.QueryAsync<string>(
            "SELECT DISTINCT category FROM kpi_definitions ORDER BY category");
        return Ok(rows);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> Get(string id)
    {
        var row = await _db.QuerySingleOrDefaultAsync<dynamic>(
            "SELECT * FROM kpi_definitions WHERE id = @id", new { id });
        return row is null ? NotFound(new { error = "KPI not found" }) : Ok(row);
    }

    public class CreateKpiDto
    {
        public string? Name { get; set; }
        public string? Code { get; set; }
        public string? Category { get; set; }
        public string? Description { get; set; }
        public string? Formula { get; set; }
        public string? Unit { get; set; }
        public string? Direction { get; set; }
        public List<string>? ApplicableRoles { get; set; }
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateKpiDto dto)
    {
        if (!ValidateFormula(dto.Formula))
            return BadRequest(new { error = "Invalid formula: must be valid JSON with a recognized type (simple, ratio, growth, team, static)" });

        var id = Guid.NewGuid().ToString();
        await _db.ExecuteAsync(@"
            INSERT INTO kpi_definitions (id, name, code, category, description, formula, unit, direction, applicable_roles)
            VALUES (@id, @name, @code, @category, @description, @formula, @unit, @direction, @roles)",
            new {
                id, dto.Name, dto.Code, dto.Category, dto.Description,
                formula = dto.Formula ?? "",
                unit = dto.Unit ?? "currency",
                direction = dto.Direction ?? "higher_is_better",
                roles = JsonSerializer.Serialize(dto.ApplicableRoles ?? new())
            });
        var kpi = await _db.QuerySingleOrDefaultAsync<dynamic>("SELECT * FROM kpi_definitions WHERE id = @id", new { id });
        return StatusCode(201, kpi);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(string id, [FromBody] CreateKpiDto dto)
    {
        var existing = await _db.QuerySingleOrDefaultAsync<dynamic>("SELECT id FROM kpi_definitions WHERE id = @id", new { id });
        if (existing is null) return NotFound(new { error = "KPI not found" });
        if (!ValidateFormula(dto.Formula))
            return BadRequest(new { error = "Invalid formula" });

        await _db.ExecuteAsync(@"
            UPDATE kpi_definitions SET
                name = COALESCE(@name, name),
                code = COALESCE(@code, code),
                category = COALESCE(@category, category),
                description = COALESCE(@description, description),
                formula = COALESCE(@formula, formula),
                unit = COALESCE(@unit, unit),
                direction = COALESCE(@direction, direction),
                applicable_roles = COALESCE(@roles, applicable_roles)
            WHERE id = @id",
            new {
                id, dto.Name, dto.Code, dto.Category, dto.Description, dto.Formula,
                dto.Unit, dto.Direction,
                roles = dto.ApplicableRoles == null ? null : JsonSerializer.Serialize(dto.ApplicableRoles)
            });
        var updated = await _db.QuerySingleOrDefaultAsync<dynamic>("SELECT * FROM kpi_definitions WHERE id = @id", new { id });
        return Ok(updated);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var existing = await _db.QuerySingleOrDefaultAsync<dynamic>("SELECT id FROM kpi_definitions WHERE id = @id", new { id });
        if (existing is null) return NotFound(new { error = "KPI not found" });
        await _db.ExecuteAsync("UPDATE kpi_definitions SET is_active = 0 WHERE id = @id", new { id });
        return Ok(new { success = true });
    }
}
